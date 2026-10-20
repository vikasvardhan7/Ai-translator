export function PrivacyPolicy() {
  return (
    <main className="page-content legal-page">
      <p className="eyebrow">Voice Translator</p>
      <h1 tabIndex={-1}>Privacy</h1>

      <section className="legal-section">
        <h2>What happens during a conversation</h2>
        <p>The microphone listens while a conversation is open and stops when it ends. Each spoken sentence is sent to Google's Gemini service to be transcribed, translated and, when available, spoken aloud. On Google's free tier, submitted data may be used to improve Google's products.</p>
        <p>To show words while they are spoken, the app uses the browser's own speech recognition, which sends what the microphone hears to the browser's maker (Microsoft for Edge, Google for Chrome). It can be turned off in Settings during a conversation.</p>
        <p>To tell apart people who share a language, the server compares a short set of numbers describing each sentence's voice (not the recording) with the voices heard earlier in the same conversation. They are kept only in memory and dropped when the conversation ends.</p>
      </section>
      <section className="legal-section">
        <h2>What is kept</h2>
        <p>Nothing is saved. Audio is dropped as soon as a sentence is translated, captions live only in this page, and everything is gone when the conversation ends or the page is closed. There are no accounts, and no cookies or analytics are used.</p>
      </section>
    </main>
  );
}

export function TermsAndConditions() {
  return (
    <main className="page-content legal-page">
      <p className="eyebrow">Voice Translator</p>
      <h1 tabIndex={-1}>Terms</h1>

      <section className="legal-section">
        <h2>Consent</h2>
        <p>Everyone whose voice is heard must agree before a conversation starts. Their speech is sent to Google's Gemini service for transcription and translation.</p>
      </section>
      <section className="legal-section">
        <h2>Translation limits</h2>
        <p>Translations may contain errors. Do not rely on them for medical, legal or safety-critical decisions.</p>
      </section>
      <section className="legal-section">
        <h2>Availability</h2>
        <p>The service uses free online services with usage limits, so it may sometimes be unavailable or slower.</p>
      </section>
    </main>
  );
}
