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

// Register Source Serif 4 (English serif) font family
Font.register({
  family: 'SourceSerif4',
  fonts: [
    // Normal styles
    {
      src: '/fonts/SourceSerif4-Regular.ttf',
      fontWeight: 400,
      fontStyle: 'normal',
    },
    {
      src: '/fonts/SourceSerif4-Semibold.ttf',
      fontWeight: 600,
      fontStyle: 'normal',
    },
    {
      src: '/fonts/SourceSerif4-Bold.ttf',
      fontWeight: 700,
      fontStyle: 'normal',
    },
    // Italic styles
    {
      src: '/fonts/SourceSerif4-It.ttf',
      fontWeight: 400,
      fontStyle: 'italic',
    },
    {
      src: '/fonts/SourceSerif4-SemiboldIt.ttf',
      fontWeight: 600,
      fontStyle: 'italic',
    },
    {
      src: '/fonts/SourceSerif4-BoldIt.ttf',
      fontWeight: 700,
      fontStyle: 'italic',
    },
  ],
});

// Register Amiri (Arabic serif) font family
Font.register({
  family: 'Amiri',
  fonts: [
    // Normal styles
    {
      src: '/fonts/Amiri-Regular.ttf',
      fontWeight: 400,
      fontStyle: 'normal',
    },
    {
      src: '/fonts/Amiri-Bold.ttf',
      fontWeight: 700,
      fontStyle: 'normal',
    },
    // Italic styles
    {
      src: '/fonts/Amiri-Italic.ttf',
      fontWeight: 400,
      fontStyle: 'italic',
    },
    {
      src: '/fonts/Amiri-BoldItalic.ttf',
      fontWeight: 700,
      fontStyle: 'italic',
    },
  ],
});

// Disable hyphenation globally
Font.registerHyphenationCallback((word) => [word]);
