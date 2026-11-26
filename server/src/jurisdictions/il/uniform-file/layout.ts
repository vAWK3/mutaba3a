import { alpha, amount, FieldOverflowError, numeric, quantity } from './format.js';

/**
 * MUT-569 (ADR-272): the uniform file's records as the spec 1.31 tables give them (§3.1–3.2, §4.1–4.5): field number,
 * kind and width, in order, so a position is the sum of the widths before it. Cancelled fields (width 0) are left out.
 *
 * Kinds: X alphanumeric; N numeric (dates YYYYMMDD and times HHMM too); A signed amount, two implied decimals
 * (X9(12)v99 is 15 wide, X9(9)v99 is 12); Q signed quantity, four implied decimals (17 wide).
 */
export type FieldKind = 'X' | 'N' | 'A' | 'Q';
export interface FieldSpec {
  field: number;
  kind: FieldKind;
  width: number;
}

const f = (field: number, kind: FieldKind, width: number): FieldSpec => ({ field, kind, width });

const A000: FieldSpec[] = [
  f(1000, 'X', 4), f(1001, 'X', 5), f(1002, 'N', 15), f(1003, 'N', 9), f(1004, 'N', 15), f(1005, 'X', 8),
  f(1006, 'N', 8), f(1007, 'X', 20), f(1008, 'X', 20), f(1009, 'N', 9), f(1010, 'X', 20), f(1011, 'N', 1),
  f(1012, 'X', 50), f(1013, 'N', 1), f(1014, 'N', 1), f(1015, 'N', 9), f(1016, 'N', 9), f(1017, 'X', 10),
  f(1018, 'X', 50), f(1019, 'X', 50), f(1020, 'X', 10), f(1021, 'X', 30), f(1022, 'X', 8), f(1023, 'N', 4),
  f(1024, 'N', 8), f(1025, 'N', 8), f(1026, 'N', 8), f(1027, 'N', 4), f(1028, 'N', 1), f(1029, 'N', 1),
  f(1030, 'X', 20), f(1032, 'X', 3), f(1034, 'N', 1), f(1035, 'X', 46),
];

const INI_SUMMARY: FieldSpec[] = [f(1050, 'X', 4), f(1051, 'N', 15)];

const A100: FieldSpec[] = [f(1100, 'X', 4), f(1101, 'N', 9), f(1102, 'N', 9), f(1103, 'N', 15), f(1104, 'X', 8), f(1105, 'X', 50)];

const C100: FieldSpec[] = [
  f(1200, 'X', 4), f(1201, 'N', 9), f(1202, 'N', 9), f(1203, 'N', 3), f(1204, 'X', 20), f(1205, 'N', 8),
  f(1206, 'N', 4), f(1207, 'X', 50), f(1208, 'X', 50), f(1209, 'X', 10), f(1210, 'X', 30), f(1211, 'X', 8),
  f(1212, 'X', 30), f(1213, 'X', 2), f(1214, 'X', 15), f(1215, 'N', 9), f(1216, 'N', 8), f(1217, 'A', 15),
  f(1218, 'X', 3), f(1219, 'A', 15), f(1220, 'A', 15), f(1221, 'A', 15), f(1222, 'A', 15), f(1223, 'A', 15),
  f(1224, 'A', 12), f(1225, 'X', 15), f(1226, 'X', 10), f(1228, 'X', 1), f(1230, 'N', 8), f(1231, 'X', 7),
  f(1233, 'X', 9), f(1234, 'N', 7), f(1235, 'X', 13),
];

const D110: FieldSpec[] = [
  f(1250, 'X', 4), f(1251, 'N', 9), f(1252, 'N', 9), f(1253, 'N', 3), f(1254, 'X', 20), f(1255, 'N', 4),
  f(1256, 'N', 3), f(1257, 'X', 20), f(1258, 'N', 1), f(1259, 'X', 20), f(1260, 'X', 30), f(1261, 'X', 50),
  f(1262, 'X', 30), f(1263, 'X', 20), f(1264, 'Q', 17), f(1265, 'A', 15), f(1266, 'A', 15), f(1267, 'A', 15),
  f(1268, 'N', 4), f(1270, 'X', 7), f(1272, 'N', 8), f(1273, 'N', 7), f(1274, 'X', 7), f(1275, 'X', 21),
];

const D120: FieldSpec[] = [
  f(1300, 'X', 4), f(1301, 'N', 9), f(1302, 'N', 9), f(1303, 'N', 3), f(1304, 'X', 20), f(1305, 'N', 4),
  f(1306, 'N', 1), f(1307, 'N', 10), f(1308, 'N', 10), f(1309, 'N', 15), f(1310, 'N', 10), f(1311, 'N', 8),
  f(1312, 'A', 15), f(1313, 'N', 1), f(1314, 'X', 20), f(1315, 'N', 1), f(1320, 'X', 7), f(1322, 'N', 8),
  f(1323, 'N', 7), f(1324, 'X', 60),
];

const Z900: FieldSpec[] = [f(1150, 'X', 4), f(1151, 'N', 9), f(1152, 'N', 9), f(1153, 'N', 15), f(1154, 'X', 8), f(1155, 'N', 15), f(1156, 'X', 50)];

export const LAYOUTS = { A000, INI_SUMMARY, A100, C100, D110, D120, Z900 } as const;
export type RecordCode = keyof typeof LAYOUTS;

export type FieldValue = string | number | bigint | null | undefined;

/** One record as text at its exact width. A field left out is blank: spaces, zeros, or a zero amount, by its kind. */
export function renderRecord(code: RecordCode, values: Readonly<Record<number, FieldValue>>): string {
  return LAYOUTS[code]
    .map(({ field, kind, width }) => {
      const value = values[field];
      try {
        switch (kind) {
          case 'X':
            return alpha(value === null || value === undefined ? null : String(value), width);
          case 'N':
            return numeric(value, width);
          case 'A':
            return amount(typeof value === 'bigint' ? value : 0n, width);
          case 'Q':
            return quantity(typeof value === 'bigint' ? value : 0n, width);
        }
      } catch (err) {
        const message = `uniform file ${code} field ${field}: ${(err as Error).message}`;
        throw err instanceof FieldOverflowError ? new FieldOverflowError(message) : new RangeError(message);
      }
    })
    .join('');
}
