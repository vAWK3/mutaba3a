# MUT-775 test plan

Server, `server/src/__tests__/routes-vendors.test.ts` (`GET /v1/receipts/{id}: vendorDefaults`):
- registration-no. match → `categoryId` = the vendor's last category (AC1).
- exact-name match only → currency still filled, `categoryId` null (D2).
- vendor without a last category → `categoryId` null.
- last category archived → `categoryId` null (D3).
- the registration no. saved as a vendor on another profile only → `vendorDefaults` null on this one (AC3).
- `categoryId` never written into `suggested` (ADR-239 R1).

Server, `server/src/__tests__/routes-receipt-reading.test.ts` (end to end through the read job):
- a read registration no. of a saved vendor: `suggested.vendorName` from the vendor (confidence 1) and
  `vendorDefaults.categoryId` its last category (AC1).
- no match: vendor name as read, `vendorDefaults` null (AC2).
- a vendor name already stored stays (D4).

Release-QA: none until the portal fills the category (see the brief).
