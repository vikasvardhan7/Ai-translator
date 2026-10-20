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
        <h2>Your account</h2>
        <p>Signing in needs an account: your email address, your name and a password. The password is never stored, only a scrambled fingerprint of it that cannot be turned back into the password. To prove the email is yours, a 6-digit code is emailed to you; it works once, for 10 minutes. After you sign in, the browser keeps one cookie that holds a random sign-in number, so you stay signed in for 30 days unless you sign out. Everything is kept on the computer that runs the app, never sold or shared.</p>
        <p>In Account (Start menu) you can change your name or password, sign out, or delete the account, which removes your sign-ins, your scheduled meetings and everything in Gym Trainer at once.</p>
      </section>
      <section className="legal-section">
        <h2>Gym Trainer</h2>
        <p>Gym Trainer keeps what you give it for your account only: your profile (age, body, height, weight, goals, food you eat, allergies and health notes), your workout and meal plans, and every day you track. Making a plan, working out the calories of a food you typed, and the coach chat send your profile and recent days to Google's Gemini service. The coach chat itself is not saved, only what it logs for you. In Profile you can download all of it or delete it.</p>
      </section>
      <section className="legal-section">
        <h2>What is kept</h2>
        <p>Nothing of a conversation is saved. Audio is dropped as soon as a sentence is translated, captions live only in this page, and everything is gone when the conversation ends or the page is closed. Only your account, your scheduled meetings and your Gym Trainer data are kept. No analytics are used.</p>
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
        <h2>Accounts</h2>
        <p>An account is for one person. Keep the password to yourself; anyone with it can see your data. Each account has a daily limit on the AI it can use so the free service stays available for everyone.</p>
      </section>
      <section className="legal-section">
        <h2>Gym Trainer</h2>
        <p>Plans, calorie numbers and coach answers are estimates made by AI and may be wrong. They are not medical advice. Check with a doctor before starting a new exercise or diet plan, especially with an injury, a health condition or during pregnancy, and stop any exercise that hurts.</p>
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
