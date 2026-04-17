'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import styles from './page.module.css';

export default function Header() {
  const [open, setOpen] = useState(false);

  return (
    <header className={styles.header}>
      <div className={styles.logo}>
        <Image src="/canary-logo.svg" alt="Canary Data" width={280} height={60} priority style={{ height: '44px', width: 'auto' }} />
      </div>

      {/* Desktop nav */}
      <nav className={`${styles.nav} ${styles.desktopNav}`}>
        <Link href="#features">Features</Link>
        <Link href="#pricing">Pricing</Link>
        <Link href="/login">Login</Link>
      </nav>

      {/* Hamburger button — mobile only */}
      <button
        className={styles.hamburger}
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className={`${styles.hamburgerLine} ${open ? styles.hamburgerLineTopOpen : ''}`} />
        <span className={`${styles.hamburgerLine} ${open ? styles.hamburgerLineMidOpen : ''}`} />
        <span className={`${styles.hamburgerLine} ${open ? styles.hamburgerLineBottomOpen : ''}`} />
      </button>

      {/* Mobile dropdown */}
      {open && (
        <div className={styles.mobileMenu} onClick={() => setOpen(false)}>
          <Link href="#features" className={styles.mobileLink}>Features</Link>
          <Link href="#pricing" className={styles.mobileLink}>Pricing</Link>
          <Link href="/login" className={styles.mobileLink}>Login</Link>
        </div>
      )}
    </header>
  );
}
