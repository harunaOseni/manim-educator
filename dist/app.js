const orbButton = document.getElementById("ask");
const voiceStatus = document.getElementById("voice-status");
const notice = document.getElementById("notice");
const muteButton = document.getElementById("mute");
const endButton = document.getElementById("end");
const microphoneStatus = document.getElementById("mic-status");
const tutorAudio = document.getElementById("tutor-audio");
let activeSession = null;
function updateVoiceUI(state, message) {
  document.body.dataset.voice = state;
  voiceStatus.textContent = message;
  orbButton.disabled = state === "closing";
  orbButton.setAttribute(
    "aria-label",
    state === "idle" ? "Talk to your tutor" : "End conversation",
  );
  endButton.hidden = !activeSession;
  muteButton.hidden = !activeSession;
  muteButton.disabled = !activeSession?.ready || state === "closing";
  microphoneStatus.textContent = activeSession
    ? activeSession.muted
      ? "Microphone muted"
      : "Microphone on"
    : "Microphone is off";
}
function cleanupSession(session, message = "Talk to your tutor") {
  if (activeSession !== session) return;
  activeSession = null;
  clearTimeout(session.connectionTimeout);
  clearTimeout(session.closeTimer);
  clearTimeout(session.disconnectTimer);
  session.abortController.abort();
  cancelAnimationFrame(session.animationFrame);
  session.stream?.getTracks().forEach((t) => t.stop());
  session.peerConnection?.close();
  session.audioContext?.close().catch(() => {});
  tutorAudio.pause();
  tutorAudio.srcObject = null;
  tutorAudio.hidden = true;
  orbButton.style.setProperty("--level", "0");
  muteButton.textContent = "Mute";
  muteButton.setAttribute("aria-pressed", "false");
  updateVoiceUI("idle", message);
}
function handleSessionError(session, message) {
  if (activeSession !== session) return;
  cleanupSession(session);
  notice.textContent = message;
}
function createAudioMeter(session, stream) {
  const source = session.audioContext.createMediaStreamSource(stream),
    analyser = session.audioContext.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  return { analyser, data: new Float32Array(analyser.fftSize) };
}
function getAudioLevel(meter) {
  if (!meter) return 0;
  meter.analyser.getFloatTimeDomainData(meter.data);
  const sumOfSquares = meter.data.reduce(
    (sum, sample) => sum + sample * sample,
    0,
  );
  return Math.sqrt(sumOfSquares / meter.data.length);
}
function updateAudioActivity(session) {
  if (activeSession !== session) return;
  const input = session.muted ? 0 : getAudioLevel(session.input),
    output = getAudioLevel(session.output);
  orbButton.style.setProperty(
    "--level",
    Math.min(1, Math.max(input, output) * 7).toFixed(3),
  );
  if (session.ready && !session.closing)
    updateVoiceUI(
      "active",
      input > 0.025
        ? "Listening to you"
        : output > 0.015
          ? "Tutor speaking"
          : session.muted
            ? "Microphone muted"
            : "Listening",
    );
  session.animationFrame = requestAnimationFrame(() =>
    updateAudioActivity(session),
  );
}
function endConversation() {
  const session = activeSession;
  if (!session || session.closing) return;
  if (!session.ready || session.events.readyState !== "open") {
    cleanupSession(session);
    return;
  }
  session.closing = true;
  updateVoiceUI("closing", "Ending conversation…");
  // Silence capture/playback immediately while retaining transport for finalization.
  session.stream.getTracks().forEach((t) => {
    t.enabled = false;
  });
  tutorAudio.pause();
  session.events.send(JSON.stringify({ type: "session.close" }));
  session.closeTimer = setTimeout(() => {
    notice.textContent =
      "Connection released; the server did not confirm finalization.";
    cleanupSession(session);
  }, 15000);
}
function configureConnectionEvents(session) {
  session.peerConnection.ontrack = (e) => {
    if (activeSession !== session) return;
    const remote = e.streams[0] || new MediaStream([e.track]);
    tutorAudio.srcObject = remote;
    session.output = createAudioMeter(session, remote);
    tutorAudio.play().catch(() => {
      tutorAudio.hidden = false;
      notice.textContent = "Press play to hear your tutor.";
    });
  };
  session.peerConnection.onconnectionstatechange = () => {
    if (activeSession !== session) return;
    if (session.peerConnection.connectionState === "failed")
      handleSessionError(
        session,
        "Voice connection lost. Tap the orb to reconnect.",
      );
    if (session.peerConnection.connectionState === "disconnected")
      session.disconnectTimer = setTimeout(
        () =>
          handleSessionError(
            session,
            "Voice disconnected. Tap the orb to reconnect.",
          ),
        5000,
      );
    if (session.peerConnection.connectionState === "connected")
      clearTimeout(session.disconnectTimer);
  };
  session.events = session.peerConnection.createDataChannel("oai-events");
  session.events.onmessage = (e) => {
    if (activeSession !== session) return;
    let event;
    try {
      event = JSON.parse(e.data);
    } catch {
      return;
    }
    if (event.type === "session.started") {
      session.ready = true;
      clearTimeout(session.connectionTimeout);
      updateVoiceUI("active", "Listening");
    }
    if (event.type === "session.closed")
      cleanupSession(session, "Conversation ended");
    if (event.type === "error")
      handleSessionError(
        session,
        "The voice session encountered an error. Tap the orb to retry.",
      );
  };
  session.events.onclose = () => {
    if (activeSession === session)
      handleSessionError(
        session,
        "Voice connection closed. Tap the orb to reconnect.",
      );
  };
  session.events.onerror = () =>
    handleSessionError(
      session,
      "Voice connection failed. Tap the orb to retry.",
    );
}

async function waitForIceGathering(session) {
  if (session.peerConnection.iceGatheringState !== "complete")
    await new Promise((resolve, reject) => {
      const changed = () => {
        if (session.peerConnection.iceGatheringState === "complete") {
          session.peerConnection.removeEventListener(
            "icegatheringstatechange",
            changed,
          );
          resolve();
        }
      };
      session.peerConnection.addEventListener(
        "icegatheringstatechange",
        changed,
      );
      session.abortController.signal.addEventListener(
        "abort",
        () => reject(new Error("Cancelled")),
        { once: true },
      );
    });
}

async function startConversation() {
  if (activeSession) {
    endConversation();
    return;
  }
  notice.textContent = "";
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
    notice.textContent =
      "Voice needs a supported browser on HTTPS or localhost.";
    return;
  }
  const session = {
    abortController: new AbortController(),
    ready: false,
    muted: false,
  };
  activeSession = session;
  updateVoiceUI("connecting", "Connecting…");
  session.connectionTimeout = setTimeout(
    () =>
      handleSessionError(
        session,
        "Connection timed out. Tap the orb to retry.",
      ),
    40000,
  );
  try {
    session.audioContext = new AudioContext();
    await session.audioContext.resume();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    if (activeSession !== session) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    session.stream = stream;
    session.input = createAudioMeter(session, stream);
    session.peerConnection = new RTCPeerConnection();
    stream.getTracks().forEach((t) => {
      session.peerConnection.addTrack(t, stream);
      t.onended = () =>
        handleSessionError(
          session,
          "Microphone disconnected. Tap the orb to retry.",
        );
    });
    configureConnectionEvents(session);
    updateAudioActivity(session);
    await session.peerConnection.setLocalDescription(
      await session.peerConnection.createOffer(),
    );
    await waitForIceGathering(session);
    if (activeSession !== session) return;
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sdp: session.peerConnection.localDescription.sdp,
      }),
      signal: session.abortController.signal,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    if (activeSession !== session) return;
    await session.peerConnection.setRemoteDescription({
      type: "answer",
      sdp: data.transport.sdp,
    });
  } catch (e) {
    handleSessionError(
      session,
      e.name === "NotAllowedError"
        ? "Microphone access was denied. Allow it in your browser and try again."
        : e.name === "NotFoundError"
          ? "No microphone found. Connect one and try again."
          : e.message || "Could not connect. Please try again.",
    );
  }
}
function toggleMute() {
  const session = activeSession;
  if (!session?.ready || session.closing) return;
  session.muted = !session.muted;
  session.stream.getAudioTracks().forEach((t) => {
    t.enabled = !session.muted;
  });
  muteButton.textContent = session.muted ? "Unmute" : "Mute";
  muteButton.setAttribute("aria-pressed", String(session.muted));
}
function handlePageExit() {
  if (activeSession) {
    if (activeSession.events?.readyState === "open")
      activeSession.events.send(JSON.stringify({ type: "session.close" }));
    cleanupSession(activeSession);
  }
}
orbButton.addEventListener("click", startConversation);
endButton.addEventListener("click", endConversation);
muteButton.addEventListener("click", toggleMute);
window.addEventListener("pagehide", handlePageExit);
updateVoiceUI("idle", "Talk to your tutor");
