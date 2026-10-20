import AppIcon, { type IconName } from './AppIcon';

const ITEMS: Array<{ icon: IconName; title: string; text: string }> = [
  { icon: 'translator', title: 'Translator', text: 'Every conversation runs here. Say hello and it finds your language, then each sentence appears as a caption in the other language and can be spoken aloud.' },
  { icon: 'remote', title: 'Meet now', text: 'Starts a meeting at once and gives you one link that up to 5 people can open. Each types their name and says hello; then everyone talks and hears everyone else in their own language, with live captions and a transcript. People shows who is there and the link again.' },
  { icon: 'schedule', title: 'Schedule', text: 'Plan a meeting for later: its name, date, time, how long and what it is about. You get a link to copy, share, email or add to a calendar. People who open it early wait in a lobby and join as soon as you press Start meeting.' },
  { icon: 'meeting', title: 'Live captions', text: 'For a Zoom, Teams or Meet call you are already in: press Connect meeting and share the call’s tab with its audio. You get captions and a transcript in your language.' },
  { icon: 'here', title: 'Talk here', text: 'Two people, one device. Each says hello once; after that just talk.' },
  { icon: 'assistant', title: 'Assistant', text: 'Ask anything. It searches the web when it needs to, knows what has been said in the running call, and does things for you.' },
  { icon: 'developers', title: 'Developers', text: 'Use the translator from your own website or app. Make an API key, paste the one-line widget into a web page, or call the API from a server. Each key has its own daily limit and can be switched off at any time.' },
  { icon: 'personalize', title: 'Personalize', text: 'Five looks with their own live wallpapers: Ocean, Sunset, Mint, Blossom and Aurora night. Calm motion keeps everything still.' },
  { icon: 'privacy', title: 'Privacy and Terms', text: 'What is sent to Google and what is kept (nothing).' },
];

const COMMANDS = [
  'Schedule a meeting tomorrow at 5 pm for 30 minutes about the budget',
  'Start live captions',
  'Summarise the meeting so far',
  'What are the action items?',
  'Mute me',
  'Show the transcript',
  'Who is in the call?',
  'Change the theme to sunset',
  'Download the subtitles',
  'Change my language to Hindi',
  'What is the weather in Hyderabad today?',
  'End the call',
];

export default function HelpApp({ onTry }: { onTry: (text: string) => void }) {
  return (
    <div className="help-app">
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
