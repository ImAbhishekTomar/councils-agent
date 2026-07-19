import { useEffect, useRef, useState } from 'react';
import { availableLocales, useI18n } from '../i18n';
import styles from './LanguageSwitcher.module.css';

function LanguageSwitcher() {
  const { locale, setLocale } = useI18n();
  const [open, setOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement | null>(null);

  const currentLabel = availableLocales.find((l) => l.key === locale)?.label ?? locale;

  useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      if (switcherRef.current && !switcherRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('click', onClickOutside);
    document.documentElement.lang = locale;
    return () => document.removeEventListener('click', onClickOutside);
  }, [locale]);

  const switchLocale = (key: string) => {
    setLocale(key);
    setOpen(false);
  };

  return (
    <div className={styles.languageSwitcher} ref={switcherRef}>
      <button className={styles.switcherTrigger} onClick={() => setOpen((v) => !v)}>
        {currentLabel}
        <span className={styles.caret}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <ul className={styles.switcherDropdown}>
          {availableLocales.map((loc) => (
            <li
              key={loc.key}
              className={`${styles.switcherOption} ${loc.key === locale ? styles.active : ''}`}
              onClick={() => switchLocale(loc.key)}
            >
              {loc.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default LanguageSwitcher;
