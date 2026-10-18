export interface LanguageOption {
  code: string;
  englishName: string;
  nativeName: string;
  searchText: string;
}

let optionsPromise: Promise<LanguageOption[]> | null = null;

function* isoCodeCandidates(): Generator<string> {
  const letters = 'abcdefghijklmnopqrstuvwxyz';

  for (const first of letters) {
    for (const second of letters) {
      yield `${first}${second}`;
    }
  }

  for (const first of letters) {
    for (const second of letters) {
      for (const third of letters) {
        yield `${first}${second}${third}`;
      }
    }
  }
}

/** Builds language options from the browser's ICU data without shipping a code list. */
export function loadLanguageOptions(): Promise<LanguageOption[]> {
  if (optionsPromise) {
    return optionsPromise;
  }

  optionsPromise = new Promise((resolve, reject) => {
    try {
      const englishNames = new Intl.DisplayNames(['en'], { type: 'language' });
      const codes = isoCodeCandidates();
      const options: LanguageOption[] = [];
      const seenNames = new Set<string>();

      function processChunk(): void {
        try {
          for (let processed = 0; processed < 512; processed += 1) {
            const next = codes.next();
            if (next.done) {
              options.sort((left, right) => left.englishName.localeCompare(right.englishName, 'en'));
              resolve(options);
              return;
            }

            const code = next.value;
            const englishName = englishNames.of(code);
            if (!englishName || englishName.toLowerCase() === code) {
              continue;
            }

            const normalizedName = englishName.toLocaleLowerCase('en');
            if (seenNames.has(normalizedName)) {
              continue;
            }
            seenNames.add(normalizedName);

            let nativeName = englishName;
            try {
              nativeName = new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? englishName;
            } catch {
              nativeName = englishName;
            }
            if (nativeName.toLowerCase() === code) {
              nativeName = englishName;
            }

            options.push({
              code,
              englishName,
              nativeName,
              searchText: `${code} ${englishName} ${nativeName}`.toLocaleLowerCase(),
            });
          }

          globalThis.setTimeout(processChunk, 0);
        } catch (error) {
          optionsPromise = null;
          reject(error);
        }
      }

      processChunk();
    } catch (error) {
      optionsPromise = null;
      reject(error);
    }
  });

  return optionsPromise;
}
