import AppIcon, { type IconName } from './AppIcon';

const ITEMS: Array<{ icon: IconName; title: string; text: string }> = [
  { icon: 'translator', title: 'Translator', text: 'Every conversation runs here. Say hello and it finds your language, then each sentence appears as a caption in the other language and can be spoken aloud.' },
  { icon: 'meeting', title: 'Meeting captions', text: 'Join your Meet, Teams or Zoom call as usual, open this, then press Connect meeting and share the meeting tab with its audio. You get captions and a transcript in your language.' },
  { icon: 'remote', title: 'Call another device', text: 'Makes one invite link that up to 5 people can open. Each says hello once; then everyone talks and hears everyone else in their own language. People shows who is there and the link again.' },
  { icon: 'here', title: 'Talk next to me', text: 'Two people, one device. Each says hello once; after that just talk.' },
  { icon: 'assistant', title: 'Assistant', text: 'Ask anything. It searches the web when it needs to, knows what has been said in the running call, and does things for you.' },
  { icon: 'personalize', title: 'Personalize', text: 'Five looks with their own live wallpapers: Ocean, Sunset, Mint, Blossom and Aurora night. Calm motion keeps everything still.' },
  { icon: 'privacy', title: 'Privacy and Terms', text: 'What is sent to Google and what is kept (nothing).' },
];

const COMMANDS = [
  'Start meeting captions',
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
