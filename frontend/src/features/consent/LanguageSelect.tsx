import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import type { LanguageOption } from './languageOptions';

interface LanguageSelectProps {
  label: string;
  value: string;
  languages: LanguageOption[];
  onChange: (languageCode: string) => void;
}

function optionLabel(option: LanguageOption): string {
  return option.nativeName === option.englishName
    ? option.englishName
    : `${option.englishName}: ${option.nativeName}`;
}

export default function LanguageSelect({ label, value, languages, onChange }: LanguageSelectProps) {
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const listId = `${inputId}-list`;
  const selectedOption = languages.find((language) => language.code === value);
  const [query, setQuery] = useState(value);
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setQuery(selectedOption ? optionLabel(selectedOption) : value);
      setActiveIndex(-1);
    }
  }, [isOpen, selectedOption, value]);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }
  }, []);

  const filteredLanguages = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    if (!search) {
      return languages;
    }
    return languages.filter((language) => language.searchText.includes(search)).slice(0, 100);
  }, [languages, query]);

  function openOptions(): void {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setIsClosing(false);
    setIsOpen(true);
  }

  function closeOptions(): void {
    if (!isOpen) {
      return;
    }
    setIsOpen(false);
    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      setIsClosing(false);
      closeTimerRef.current = null;
    }, 100);
  }

  function selectLanguage(option: LanguageOption): void {
    onChange(option.code);
    setQuery(optionLabel(option));
    closeOptions();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      openOptions();
      setActiveIndex((index) => filteredLanguages.length === 0
        ? -1
        : index < 0 ? 0 : (index + 1) % filteredLanguages.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      openOptions();
      setActiveIndex((index) => filteredLanguages.length === 0
        ? -1
        : index < 0 ? filteredLanguages.length - 1 : (index - 1 + filteredLanguages.length) % filteredLanguages.length);
    } else if (event.key === 'Enter' && isOpen && activeIndex >= 0 && filteredLanguages[activeIndex]) {
      event.preventDefault();
      selectLanguage(filteredLanguages[activeIndex]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeOptions();
      setQuery(selectedOption ? optionLabel(selectedOption) : value);
    } else if (event.key === 'Tab') {
      closeOptions();
    }
  }

  return (
    <div className="language-select">
      <label className="field-label" htmlFor={inputId}>{label}</label>
      <div className="language-select-wrap">
        <input
          id={inputId}
          className="text-input language-input"
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls={listId}
          aria-activedescendant={isOpen && filteredLanguages[activeIndex]
            ? `${listId}-${filteredLanguages[activeIndex].code}`
            : undefined}
          aria-describedby={hintId}
          value={query}
          onFocus={openOptions}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setActiveIndex(-1);
            openOptions();
            onChange('');
          }}
          onKeyDown={handleKeyDown}
          onBlur={closeOptions}
        />
        {(isOpen || isClosing) && (
          <ul
            className="language-options"
            id={listId}
            role="listbox"
            aria-label={label}
            aria-hidden={!isOpen}
            data-state={isOpen ? 'open' : 'closing'}
          >
            {filteredLanguages.length === 0 ? (
              <li className="language-empty" role="status">No languages found</li>
            ) : filteredLanguages.map((language, index) => (
              <li
                className="language-option"
                id={`${listId}-${language.code}`}
                key={language.code}
                role="option"
                aria-selected={index === activeIndex}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectLanguage(language)}
              >
                {optionLabel(language)}
                <span className="language-option-code">{language.code}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="language-code-hint" id={hintId}>
        Search by language name, native name, or ISO 639 code.
      </p>
    </div>
  );
}
