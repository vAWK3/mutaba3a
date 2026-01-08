import { Font } from '@react-pdf/renderer';

// Register IBM Plex Sans Arabic font family
Font.register({
  family: 'IBMPlexSansArabic',
  fonts: [
    {
      src: '/fonts/IBMPlexSansArabic-Regular.ttf',
      fontWeight: 400,
    },
    {
      src: '/fonts/IBMPlexSansArabic-Medium.ttf',
      fontWeight: 500,
    },
    {
      src: '/fonts/IBMPlexSansArabic-SemiBold.ttf',
      fontWeight: 600,
    },
    {
      src: '/fonts/IBMPlexSansArabic-Bold.ttf',
      fontWeight: 700,
    },
  ],
});

// Register IBM Plex Sans (English) font family
Font.register({
  family: 'IBMPlexSans',
  fonts: [
    {
      src: '/fonts/IBMPlexSans-Regular.ttf',
      fontWeight: 400,
    },
    {
      src: '/fonts/IBMPlexSans-Medium.ttf',
      fontWeight: 500,
    },
    {
      src: '/fonts/IBMPlexSans-SemiBold.ttf',
      fontWeight: 600,
    },
    {
      src: '/fonts/IBMPlexSans-Bold.ttf',
      fontWeight: 700,
    },
  ],
});

// Disable hyphenation globally
Font.registerHyphenationCallback((word) => [word]);
