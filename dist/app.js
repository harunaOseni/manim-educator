const notice = document.getElementById('notice');
let noticeTimer;

document.getElementById('ask').addEventListener('click', () => {
  clearTimeout(noticeTimer);
  notice.textContent = 'Voice is not connected yet. This orb is the entry point for your conversation with the tutor.';
  noticeTimer = setTimeout(() => { notice.textContent = ''; }, 6000);
});
