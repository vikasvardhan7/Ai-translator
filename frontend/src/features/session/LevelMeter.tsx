interface LevelMeterProps {
  personName: string;
  level: number;
}

export default function LevelMeter({ personName, level }: LevelMeterProps) {
  const value = Math.round(Math.max(0, Math.min(1, level)) * 100);

  return (
    <div
      className="level-meter"
      role="meter"
      aria-label={`Microphone level for ${personName}`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      aria-valuetext={`${value}% microphone level`}
    >
      <span className="level-meter-fill" style={{ transform: `scaleX(${value / 100})` }} />
    </div>
  );
}
