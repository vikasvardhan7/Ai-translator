const LAST_UPDATED = '2026-10-18';

function LastUpdated() {
  return (
    <p className="last-updated">
      Last updated: <time dateTime={LAST_UPDATED}>October 18, 2026</time>
    </p>
  );
}

export function PrivacyPolicy() {
  return (
    <main className="page-content legal-page">
      <p className="eyebrow">Voice Translator</p>
      <h1 tabIndex={-1}>Privacy Policy</h1>
      <LastUpdated />

      <section className="legal-section">
        <h2>Who operates this service</h2>
        <p>Voice Translator is operated by [LEGAL ENTITY NAME]. For privacy questions, contact [CONTACT EMAIL].</p>
      </section>
      <section className="legal-section">
        <h2>What happens during a conversation</h2>
        <p>The microphone is active only while a recording is in progress. Speech audio is sent to Google's Gemini service for recognition and translation. On Google's free tier, submitted data may be used to improve its products.</p>
        <p>This 1D build keeps session data in backend memory. It disappears when the backend restarts; conversation history and delete controls are planned for Step 1F. The retention period for the finished service is [RETENTION PERIOD].</p>
      </section>
      <section className="legal-section">
        <h2>Accounts and other information</h2>
        <p>This version does not include an account system. Cookie use and analytics practices are [COOKIES AND ANALYTICS PRACTICES].</p>
        <p>Security measures: [SECURITY MEASURES]. Age rules: [MINIMUM AGE RULES].</p>
      </section>
      <section className="legal-section">
        <h2>Your choices</h2>
        <p>Conversation history is not available in this build. Session data stays in backend memory and disappears when the backend restarts. Reopen, download, and delete controls are planned for Step 1F.</p>
      </section>
      <section className="legal-section">
        <h2>Governing law</h2>
        <p>Applicable jurisdiction and governing law: [JURISDICTION AND GOVERNING LAW].</p>
      </section>
    </main>
  );
}

export function TermsAndConditions() {
  return (
    <main className="page-content legal-page">
      <p className="eyebrow">Voice Translator</p>
      <h1 tabIndex={-1}>Terms and Conditions</h1>
      <LastUpdated />

      <section className="legal-section">
        <h2>Using the service</h2>
        <p>Use Voice Translator lawfully and do not interfere with another person's use of the service. The service is operated by [LEGAL ENTITY NAME].</p>
      </section>
      <section className="legal-section">
        <h2>Consent to recording</h2>
        <p>You are responsible for getting consent from everyone whose speech is captured. The microphone is active only while a recording is in progress, and speech audio is sent to Google's Gemini service for recognition and translation.</p>
      </section>
      <section className="legal-section">
        <h2>Translation limits</h2>
        <p>Translations may contain errors. They are not guaranteed to be accurate and should not be relied on for medical, legal, or safety-critical decisions.</p>
      </section>
      <section className="legal-section">
        <h2>Availability and deletion</h2>
        <p>The service may not always be available. In this 1D build, sessions are held in backend memory and disappear when the backend restarts. Conversation history and deletion controls are planned for Step 1F.</p>
      </section>
      <section className="legal-section">
        <h2>Changes and governing law</h2>
        <p>These terms may change. The updated date above shows when this page was last revised. Applicable jurisdiction and governing law: [JURISDICTION AND GOVERNING LAW]. For questions, contact [CONTACT EMAIL].</p>
      </section>
    </main>
  );
}

export function HistoryNotice() {
  return (
    <main className="page-content legal-page history-notice">
      <p className="eyebrow">Voice Translator</p>
      <h1 tabIndex={-1}>History</h1>
      <p>History will be available in Step 1F.</p>
    </main>
  );
}
