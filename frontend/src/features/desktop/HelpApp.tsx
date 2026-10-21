import AppIcon, { type IconName } from './AppIcon';
import { askToInstall, INSTALL_STEPS, useInstallWay } from './install';

const ITEMS: Array<{ icon: IconName; title: string; text: string }> = [
  { icon: 'remote', title: 'Meet', text: 'Video calls for up to 4 people, like Google Meet or Teams. Everyone hears each other’s own voice and sees each other’s camera, and live captions show what each person says in your own language. Chat with everyone, record the call to your device (everyone sees a Recording sign), and pick your microphone, camera and speaker. Meet now starts one and gives you a link to send.' },
  { icon: 'schedule', title: 'Schedule', text: 'Plan a meeting for later: its name, date, time, how long and what it is about. You get a link to copy, share, email or add to a calendar. People who open it early wait until you press Start meeting, then join the call.' },
  { icon: 'trainer', title: 'Gym Trainer', text: 'Your own trainer: tell it about yourself and the AI makes a weekly workout and meal plan you can edit. Watch how any exercise is done and which muscles it works, start a guided workout that talks you through every set, photograph your food to count its calories, keep progress photos, and talk to the coach; it answers out loud and logs what you tell it.' },
  { icon: 'assistant', title: 'Assistant', text: 'Ask anything. It searches the web when it needs to, knows what has been said in the running call, and does things for you.' },
  { icon: 'developers', title: 'Developers', text: 'Use the translator from your own website or app. Make an API key, paste the one-line widget into a web page, or call the API from a server. Each key has its own daily limit and can be switched off at any time.' },
  { icon: 'personalize', title: 'Personalize', text: 'Five looks with their own live wallpapers: Ocean, Sunset, Mint, Blossom and Aurora night. Calm motion keeps everything still.' },
  { icon: 'privacy', title: 'Privacy and Terms', text: 'What is sent to Google and what is kept (nothing).' },
];

const COMMANDS = [
  'Schedule a meeting tomorrow at 5 pm for 30 minutes about the budget',
  'Start a meeting',
  'Summarise the meeting so far',
  'What are the action items?',
  'Mute me',
  'Who is in the call?',
  'Change the theme to sunset',
  'Change my language to Hindi',
  'What is the weather in Hyderabad today?',
  'End the call',
];

function InstallSection() {
  const way = useInstallWay();
  if (way === 'installed') {
    return null;
  }
  return (
    <section className="help-install" aria-labelledby="help-install-title">
      <AppIcon name="install" size="large" />
      <div>
        <h3 id="help-install-title">Install the app</h3>
        <p>{INSTALL_STEPS[way]}</p>
        {way === 'button' && (
          <button className="button button-primary button-small" type="button" onClick={() => void askToInstall()}>
            Install the app
          </button>
        )}
      </div>
    </section>
  );
}

export default function HelpApp({ onTry }: { onTry: (text: string) => void }) {
  return (
    <div className="help-app">
      <InstallSection />
      <p className="help-lead">Double-click an icon on the desktop, pick it from Start, or just tell the assistant what you want.</p>
      <ul className="help-list">
        {ITEMS.map((item) => (
          <li key={item.title}>
            <AppIcon name={item.icon} size="large" />
            <div>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </div>
          </li>
        ))}
      </ul>
      <h3 className="help-heading">Try saying to the assistant</h3>
      <div className="help-commands">
        {COMMANDS.map((command) => (
          <button className="chip" type="button" key={command} onClick={() => onTry(command)}>
            {command}
          </button>
        ))}
      </div>
      <p className="help-note">Windows can be dragged by their title bar, maximized with a double-click, and minimized to the taskbar. A minimized call keeps running.</p>
    </div>
  );
}
