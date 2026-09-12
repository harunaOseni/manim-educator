// The PostHog project token is public; it only permits event ingestion.
const productionHosts = new Set([
  "manimeducator.com",
  "www.manimeducator.com",
  "manim-educator.netlify.app",
]);

if (productionHosts.has(location.hostname)) {
  const script = document.createElement("script");
  script.src = "https://us-assets.i.posthog.com/static/array.js";
  script.async = true;
  script.onload = () => {
    window.posthog.init("phc_qqcfvkhKmmCcAJuNditfw3yoX8JFfFLWFUcHvYtseQJU", {
      api_host: "https://us.i.posthog.com",
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_dead_clicks: false,
      capture_exceptions: false,
      capture_heatmaps: false,
      capture_performance: false,
      disable_session_recording: true,
      disable_surveys: true,
      advanced_disable_flags: true,
      person_profiles: "never",
      persistence: "localStorage",
      persistence_name: "manim_educator",
      before_send: (event) => {
        if (event.event !== "$pageview") return null;
        // Send only visitor metadata, never board content or URL query strings.
        const allowed = [
          "token", "distinct_id", "$session_id", "$window_id", "$device_id",
          "$browser", "$browser_version", "$os", "$os_version",
          "$device_type", "$screen_height", "$screen_width",
          "$viewport_height", "$viewport_width", "$lib", "$lib_version",
          "$is_identified", "$process_person_profile",
        ];
        const properties = Object.fromEntries(
          allowed.filter((key) => key in event.properties)
            .map((key) => [key, event.properties[key]]),
        );
        let referringDomain = "";
        try { referringDomain = new URL(document.referrer).hostname; } catch {}
        event.properties = {
          ...properties,
          app: "manim-educator",
          $current_url: location.origin + location.pathname,
          $host: location.hostname,
          $pathname: location.pathname,
          $referring_domain: referringDomain || "$direct",
        };
        return event;
      },
      loaded: (analytics) => analytics.capture("$pageview"),
    });
  };
  document.head.append(script);
}
