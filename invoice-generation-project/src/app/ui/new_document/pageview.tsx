import { useState } from "react";
import { Box, Button, Flex } from "@mantine/core";
import { PDFViewer } from "@react-pdf/renderer";
import PreviewDoc from "./preview_doc";
import { DocumentData, ProfileData } from "@/types";
import { IconArrowLeft, IconArrowRight } from "@tabler/icons-react";

const templates = ["template1", "template2", "template3"];

const DocumentPageView = ({
  document,
  activeProfile,
}: {
  document: DocumentData;
  activeProfile: ProfileData | undefined;
}) => {
  const [currentPage, setCurrentPage] = useState<number>(0);

  const handleNext = () =>
    setCurrentPage((prev) => (prev + 1) % templates.length);
  const handlePrevious = () =>
    setCurrentPage((prev) => (prev - 1 + templates.length) % templates.length);

  return (
    <Box w="100%" h="100%" p="xl">
      <PDFViewer width={"100%"} height={"100%"}>
        <PreviewDoc
          document={document}
          template={templates[currentPage]}
          profile={activeProfile}
        />
      </PDFViewer>
      <Flex justify={"space-evenly"}>
        <Button onClick={handlePrevious} disabled={currentPage === 0}>
          <IconArrowLeft />
        </Button>
        <Button
          onClick={handleNext}
          disabled={currentPage === templates.length - 1}
        >
          <IconArrowRight />
        </Button>
      </Flex>
    </Box>
  );
};

export default DocumentPageView;
