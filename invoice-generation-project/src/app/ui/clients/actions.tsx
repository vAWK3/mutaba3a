// "use client";
// import {
//   Group,
//   ActionIcon,
//   Box,
//   Menu,
//   MenuTarget,
//   Text,
//   MenuDropdown,
//   MenuItem,
// } from "@mantine/core";
// import {
//   IconCheck,
//   IconMailForward,
//   IconDownload,
//   IconDots,
// } from "@tabler/icons-react";
// import {
//   isDocumentCompletable,
//   TableDocumentModel,
// } from "../../../../models/table_document";
// import { useRouter } from "next/navigation";
// import { IssuedDocumentType } from "../../../../models/enums/document_type";
// import { useTranslations } from "next-intl";

// interface ActionProps {
//   document: TableDocumentModel;
// }

// const ClientActions = ({ document }: ActionProps) => {
//   const router = useRouter();
//   const t = useTranslations("Clients");

//   return (
//     <>
//       <Group justify="flex-end" visibleFrom="sm">
//         {isDocumentCompletable(document.type, document.status) ? (
//           <ActionIcon
//             visibleFrom="lg"
//             variant="outline"
//             bd="transparent"
//             c="metal"
//             // onClick={confirmPayment}
//             onClick={(e: React.MouseEvent) => {
//               e.stopPropagation();
//             }}
//           >
//             <IconCheck />
//           </ActionIcon>
//         ) : (
//           <ActionIcon
//             visibleFrom="lg"
//             c="transparent"
//             disabled
//             bg="transparent"
//           ></ActionIcon>
//         )}
//         <ActionIcon
//           visibleFrom="lg"
//           key="email"
//           variant="outline"
//           bd="transparent"
//           c="metal"
//           onClick={(e: React.MouseEvent) => {
//             e.stopPropagation();
//           }}
//         >
//           <IconMailForward />
//         </ActionIcon>
//         <ActionIcon
//           visibleFrom="lg"
//           key="download"
//           variant="outline"
//           bd="transparent"
//           c="metal"
//           onClick={(e: React.MouseEvent) => {
//             e.stopPropagation();
//           }}
//         >
//           <IconDownload />
//         </ActionIcon>
//       </Group>
//       <Box hiddenFrom="sm">
//         <Menu>
//           <MenuTarget>
//             <ActionIcon
//               onClick={(e: React.MouseEvent) => {
//                 e.stopPropagation();
//               }}
//               key="more"
//               variant="outline"
//               bd="transparent"
//               c="metal"
//             >
//               <IconDots />
//             </ActionIcon>
//           </MenuTarget>
//           <MenuDropdown>
//             {isDocumentCompletable(document.type, document.status) && (
//               <MenuItem
//                 onClick={(e: React.MouseEvent) => {
//                   e.stopPropagation();
//                 }}
//                 //    onClick={confirmPayment}
//               >
//                 <Text>{t("confirm_payment")}</Text>
//               </MenuItem>
//             )}
//             <MenuItem
//               onClick={(e: React.MouseEvent) => {
//                 e.stopPropagation();
//               }}
//             >
//               <Text>{t("send_to_client")}</Text>
//             </MenuItem>
//             <MenuItem
//               onClick={(e: React.MouseEvent) => {
//                 e.stopPropagation();
//               }}
//             >
//               <Text>
//                 {t("download", {
//                   type: document.type,
//                 })}
//               </Text>
//             </MenuItem>
//           </MenuDropdown>
//         </Menu>
//       </Box>
//     </>
//   );
// };

// export default ClientActions;
