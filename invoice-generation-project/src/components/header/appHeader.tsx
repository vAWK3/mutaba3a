import { ActionIcon, Button, Flex, Group } from "@mantine/core";
import { IconPencilPlus, IconUpload } from "@tabler/icons-react";
import Breadcrumb from "../breadcrumb";
import { ReactNode } from "react";
import CreateDocumentButton from "../buttons/create_document_button";

import { useClientSpotlight } from "@/contexts/SpotlightContext";

interface AppHeaderProps {
  burgerButton?: ReactNode;
  // isGridView?: boolean;
  // onToggleGridView?: Function;
  onExport?: any;
  buttons?: ReactNode | ReactNode[];
  removeLastPath?: boolean;
  withBreadcrumb?: boolean;
  exitButton?: ReactNode;
}

const AppHeader = ({
  burgerButton,
  // isGridView = false,
  // onToggleGridView,
  onExport,
  buttons,
  removeLastPath,
  exitButton,
  withBreadcrumb = true,
}: AppHeaderProps) => {
  const editIcon = <IconPencilPlus></IconPencilPlus>;
  const spotlight = useClientSpotlight();
  return (
    <Group h="100%" px="md">
      <Flex align="center" justify="space-between" style={{ width: "100%" }}>
        <Group align="center">
          {burgerButton && burgerButton}
          {exitButton && !withBreadcrumb && exitButton}{" "}
          {/* Render leftButton if no breadcrumb */}
          {withBreadcrumb && <Breadcrumb removeLastPath={removeLastPath} />}
        </Group>
        <Group visibleFrom="sm">
          {/*onToggleGridView && (
            <CustomButton
              key="view"
              title={isGridView ? "List view" : "Grid view"}
              onClick={onToggleGridView}
              icon={
                isGridView ? <IconList size={16} /> : <IconGridDots size={16} />
              }
            ></CustomButton>
          )*/}
          {onExport && (
            <Button
              variant={"default"}
              key="export"
              title="Export"
              onClick={onExport}
              leftSection={<IconUpload size={16} />}
            />
          )}
          {buttons && buttons}
          {!buttons && <CreateDocumentButton variant="filled" />}
        </Group>
        <Group hiddenFrom="sm">
          {/*onToggleGridView && (
            <ActionIcon
              key="grid"
              variant="default"
              onClick={(_) => onToggleGridView()}
            >
              {isGridView ? <IconList size={16} /> : <IconGridDots size={16} />}
            </ActionIcon>
          )*/}
          {onExport && (
            <ActionIcon key="export" variant="default">
              <IconUpload size={16}></IconUpload>
            </ActionIcon>
          )}
          {buttons && buttons}
          {!buttons && (
            <CreateDocumentButton variant="filled" iconOnly={true} />
          )}
        </Group>
      </Flex>
    </Group>
  );
};

export default AppHeader;
