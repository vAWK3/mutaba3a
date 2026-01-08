import { fontAr, fontEn, fontMono } from "@/app/ui/fonts";
import {
  Button,
  createTheme,
  MantineColorsTuple,
  rem,
  Table,
  TableTh,
} from "@mantine/core";

const bluegray: MantineColorsTuple = [
  "#f3f3fe",
  "#e4e6ed",
  "#c8cad3",
  "#a9adb9",
  "#9093a4",
  "#808496",
  "#767c91",
  "#656a7e",
  "#585e72",
  "#4a5167",
];

const gray: MantineColorsTuple = [
  "#F7F7F7",
  "#D6D7D8",
  "#E5E7EB",
  "#CCD1D8",
  "#9AA2B1",
  "#787F8E",
  "#636D7D",
  "#424E62",
  "#334256",
  "#26314A",
];
const body: MantineColorsTuple = [
  "#F7F7F7",
  "#D6D7D8",
  "#E5E7EB",
  "#CCD1D8",
  "#9AA2B1",
  "#787F8E",
  "#636D7D",
  "#424E62",
  "#334256",
  "#26314A",
];

const dark: MantineColorsTuple = [
  "#D9E9FF", // Lightest, for subtle highlights
  "#A3B4C8", // Light hover (cool, muted gray-blue)
  "#6E7D90", // Primary light (balanced cool gray)
  "#4B596A", // Active primary (cool, darker gray)
  "#2F3B49", // Primary hover (deep, neutral gray)
  "#222D37", // Dark primary (neutral dark gray)
  "#1A232B", // Darker component hover (very dark neutral tone)
  "#12181F", // Dark components (deep charcoal)
  "#0B0F14", // Dark background (almost black, slight cool undertone)
  "#000204", // Darkest, for accents and deep background layers
];
const blue: MantineColorsTuple = [
  "#F2F7FF",
  "#DCEBFE",
  "#BEDBFE",
  "#91C3FD",
  "#61A6FA",
  "#3479E9",
  "#2463EB",
  "#1D4FD7",
  "#1E3FAE",
  "#1E3B8A",
];
const metal: MantineColorsTuple = [
  "#F7F7F7",
  "#D6D7D8",
  "#E5E7EB",
  "#CCD1D8",
  "#9AA2B1",
  "#787F8E",
  "#636D7D",
  "#424E62",
  "#334256",
  "#26314A",
];
const yellow: MantineColorsTuple = [
  "#FEFCE7",
  "#FEF9C3",
  "#FEF08B",
  "#FFE771",
  "#FACC14",
  "#E7B008",
  "#C88A04",
  "#A26107",
  "#864E0E",
  "#733F12",
];
const purple: MantineColorsTuple = [
  "#FAF5FF",
  "#F2E5FF",
  "#EAD6FF",
  "#D8B4FE",
  "#BF83FC",
  "#A855F7",
  "#9234EA",
  "#7E22CE",
  "#6A21A6",
  "#591C87",
];
const red: MantineColorsTuple = [
  "#FEF1F1",
  "#FFDCDC",
  "#FFC9C9",
  "#FFA0A0",
  "#FF6565",
  "#EF4343",
  "#DC2828",
  "#BA1C1C",
  "#981B1B",
  "#811D1D",
];

const green: MantineColorsTuple = [
  "#F2FDF5",
  "#DEFCE9",
  "#BBF7D0",
  "#85EFAC",
  "#4ADE80",
  "#1AC057",
  "#16A249",
  "#157F3C",
  "#1C713C",
  "#114C29",
];

const darkGreen: MantineColorsTuple = [
  "#134822",
  "#14522D",
  "#166434",
  "#119541",
  "#21C45D",
  "#4ADE80",
  "#85EFAC",
  "#BBF7D0",
  "#DEFCE9",
  "#F2FDF5",
];

const darkRed: MantineColorsTuple = [
  "#5D2323",
  "#822222",
  "#AC3838",
  "#DC3D3D",
  "#FA4D4D",
  "#FF6262",
  "#FF9393",
  "#FFA7A7",
  "#FFBBBB",
  "#FED0D0",
];
export const themeEnglish = createTheme({
  cursorType: "pointer",
  headings: {
    fontFamily: fontEn.style.fontFamily,
    textWrap: "pretty",
    sizes: {
      h1: { fontSize: rem(48), fontWeight: "400" },
      h2: { fontWeight: "400" },
      h3: { fontWeight: "400" },
      h4: { fontWeight: "500" },
      h5: { fontWeight: "500" },
      h6: { fontWeight: "500" },
    },
  },
  fontFamily: fontEn.style.fontFamily,
  fontFamilyMonospace: fontMono.style.fontFamily,
  fontSizes: {
    xs: rem(12),
    sm: rem(14),
    md: rem(16),
    lg: rem(18),
    xl: rem(21),
  },
  lineHeights: {
    xs: "1.4",
    sm: "1.45",
    md: "1.55",
    lg: "1.6",
    xl: "1.65",
  },

  defaultRadius: "sm",
  primaryColor: "blue",
  primaryShade: { light: 7, dark: 8 },

  colors: {
    body,
    gray,
    bluegray,
    red,
    blue,
    yellow,
    metal,
    dark,
    purple,
    green,
    darkGreen,
    darkRed,
  },
  // components: {
  //   Button: Button.extend({
  //     defaultProps: {
  //       color: 'blue.7',
  //       variant: 'fill',
  //     }
  //   }),
  //   Table: Table.extend({
  //     defaultProps: {

  //     }
  //   })
  // }
});

export const themeArabic = createTheme({
  cursorType: "pointer",
  headings: {
    fontFamily: fontAr.style.fontFamily,
    textWrap: "pretty",
    sizes: {
      h1: { fontSize: rem(48), fontWeight: "400" },
      h2: { fontWeight: "400" },
      h3: { fontWeight: "400" },
      h4: { fontWeight: "500" },
      h5: { fontWeight: "500" },
      h6: { fontWeight: "500" },
    },
  },
  fontFamily: fontAr.style.fontFamily,
  fontFamilyMonospace: fontMono.style.fontFamily,
  fontSizes: {
    xs: rem(12),
    sm: rem(14),
    md: rem(16),
    lg: rem(18),
    xl: rem(21),
  },
  lineHeights: {
    xs: "1.4",
    sm: "1.45",
    md: "1.55",
    lg: "1.6",
    xl: "1.65",
  },
  defaultRadius: "sm",
  primaryColor: "blue",
  primaryShade: { light: 7, dark: 8 },
  colors: {
    body,
    gray,
    bluegray,
    red,
    blue,
    yellow,
    metal,
    dark,
    purple,
    green,
    darkGreen,
    darkRed,
  },
  components: {
    // Button: Button.extend({
    //   defaultProps: {
    //     color: 'blue.7',
    //     variant: 'fill',
    //   }
    // }),
    // Table: Table.extend({
    //   defaultProps: {
    //   }
    // })
  },
});
