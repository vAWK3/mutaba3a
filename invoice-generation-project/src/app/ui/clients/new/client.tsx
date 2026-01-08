import { Flex, TextInput, Text } from "@mantine/core";
import { useTranslations } from "next-intl";
import { ClientData } from "@/types";
import CustomFormInput from "@/components/form/customFormInput";
import { UseFormReturnType } from "@mantine/form";
import CustomColorPicker from "@/components/colors/color_picker";

export const mutedColors = [
  "#007BFF", // Blue
  "#00BFFF", // Cyan
  "#1ABC9C", // Teal
  "#27AE60", // Green
  "#CDDC39", // Lime
  "#F1C40F", // Yellow
  "#F39C12", // Orange
  "#E74C3C", // Red
  "#9B59B6", // Grape
  "#A67DFF", // Violet
  "#3F51B5", // Indigo
  "#BDC3C7", // Gray
];
interface ClientFormData {
  form: UseFormReturnType<ClientData>;
}

const ClientForm = ({ form }: ClientFormData) => {
  const t = useTranslations("Clients");

  return (
    <CustomFormInput width={"100%"} title={t("client_details")}>
      <TextInput
        labelProps={{
          fw: "600",
          fz: "xs",
        }}
        label={t("name")}
        name="name"
        {...form.getInputProps("name")}
        withAsterisk
      />
      <TextInput
        labelProps={{
          fw: "600",
          fz: "xs",
        }}
        label={t("tax_id")}
        name="taxid"
        {...form.getInputProps("taxId")}
      />
      <TextInput
        labelProps={{
          fw: "600",
          fz: "xs",
        }}
        label={t("email")}
        name="email"
        {...form.getInputProps("email")}
        withAsterisk
      />
      <TextInput
        labelProps={{
          fw: "600",
          fz: "xs",
        }}
        label={t("phone")}
        name="phone"
        {...form.getInputProps("phoneNumber")}
      />
      <TextInput
        labelProps={{
          fw: "600",
          fz: "xs",
        }}
        label={t("city")}
        name="address.city"
        withAsterisk
        {...form.getInputProps("address.cityEn")}
      />
      <TextInput
        labelProps={{
          fw: "600",
          fz: "xs",
        }}
        label={t("address")}
        name="address.address1"
        {...form.getInputProps("address.address1En")}
        withAsterisk
      />
      <TextInput
        labelProps={{
          fw: "600",
          fz: "xs",
        }}
        label={t("ext_number")}
        name="number"
        {...form.getInputProps("externalIdentifier")}
      />
      <></>
      <Flex w={"100%"} direction={"column"} mt={"lg"} mb={"md"} gap={"sm"}>
        <Text fw={500} fz={"sm"}>
          {t("client_color")}
        </Text>

        <CustomColorPicker

          colors={mutedColors}
          onSelect={(color: string) => form.setFieldValue("color", color)}
        />
      </Flex>
    </CustomFormInput>
  );
};

export default ClientForm;
