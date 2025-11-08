const headlineInput = document.getElementById('headline') as HTMLInputElement;
const skillsInput = document.getElementById('skills') as HTMLInputElement;
const saveProfileBtn = document.getElementById('saveProfile') as HTMLButtonElement;
const resumeFileInput = document.getElementById('resumeFile') as HTMLInputElement;
const uploadBtn = document.getElementById('uploadBtn') as HTMLButtonElement;
const uploadStatus = document.getElementById('uploadStatus')!;

function loadProfile() {
  chrome.storage.local.get(['profile'], data => {
    const profile = data.profile || {};
    headlineInput.value = profile.headline || '';
    skillsInput.value = (profile.skills || []).join(', ');
  });
}

saveProfileBtn.addEventListener('click', () => {
  const profile = {
    headline: headlineInput.value.trim(),
    skills: skillsInput.value.split(',').map(s => s.trim()).filter(Boolean)
  };
  chrome.storage.local.set({ profile }, () => {
    saveProfileBtn.textContent = 'Saved!';
    setTimeout(() => (saveProfileBtn.textContent = 'Save Profile'), 1500);
  });
});

uploadBtn.addEventListener('click', async () => {
  const file = resumeFileInput.files?.[0];
  if (!file) {
    uploadStatus.textContent = 'Select a file first';
    return;
  }
  uploadStatus.textContent = 'Uploading (mock)...';
  // TODO real API call
  setTimeout(() => {
    uploadStatus.textContent = 'Uploaded (mock)';
  }, 800);
});

loadProfile();
