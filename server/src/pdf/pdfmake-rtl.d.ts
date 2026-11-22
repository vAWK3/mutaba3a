/** MUT-640: @digicole/pdfmake-rtl ships no types (Malafat declares it `any` too); only the printer is used. */
declare module '@digicole/pdfmake-rtl/js/Printer.js' {
  const Printer: unknown;
  export default Printer;
}
