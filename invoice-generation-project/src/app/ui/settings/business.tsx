import {
  Box,
  Title,
  Divider,
  rem,
  Paper,
  Image,
  TextInput,
  Grid,
  FileInput,
  Select,
  GridCol,
} from "@mantine/core";
import { IconUpload } from "@tabler/icons-react";

import { useEffect, useState } from "react";
import { useMediaQuery } from "@mantine/hooks";
import { BusinessType, Currency, Language, ProfileData } from "@/types";
import { useTranslations } from "next-intl";

import CurrencySelector from "../../../components/select/currency_select";

const ProfileSettings = () => {
  const [profile, setProfile] = useState<ProfileData>();
  const isMobile = useMediaQuery("(max-width: 50em)");
  const [logo, setLogo] = useState<File | null>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);

  const t = useTranslations("Settings");

  const handleFileChange = (file: File | null) => {
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        setImageSrc(reader.result as string); // Set the data URL as the source for the image
      };
      reader.readAsDataURL(file); // Read the file as a data URL
    } else {
      setImageSrc(null); // Reset the image source if no file is selected
    }
  };

  const gridSpan = isMobile ? 12 : 4;

  useEffect(() => {
    const fetchProfiles = async () => {
      const response = await fetch("/api/profile");
      const data = await response.json();

      if (data) {
        setProfile(data[0]);
      }
    };

    fetchProfiles();
  }, []);

  return (
    <>
      <Box w={"100%"} my={rem(30)}>
        <Title order={4} size={"md"} fw={500} mb={rem(12)}>
          {t("business")}
        </Title>
        <Divider mb={"lg"}/>
        <Grid>
          {Object.values(Language).map((item, index) => {
            return (
              <GridCol key={index} span={gridSpan}>
                <TextInput
                  label={`${t("business_name")} (${item})`}
                  defaultValue={
                    item == Language.ar
                      ? profile?.nameAr ?? ""
                      : item == Language.en
                      ? profile?.nameEn
                      : profile?.nameHe ?? ""
                  }
                />
              </GridCol>
            );
          })}
          {Object.values(Language).map((item, index) => {
            return (
              <GridCol key={index} span={gridSpan}>
                <TextInput
                  label={`${t("address")} (${item})`}
                  defaultValue={
                    item == Language.ar
                      ? profile?.address.address1Ar
                      : item == Language.en
                      ? profile?.address.address1En
                      : profile?.address.address1He
                  }
                />
              </GridCol>
            );
          })}

          <Grid.Col span={gridSpan}>
            <TextInput label={t("phone")} defaultValue={profile?.phoneNumber} />
          </Grid.Col>

          <Grid.Col span={gridSpan}>
            <Select
              label={t("tax_file")}
              defaultValue={profile?.businessType}
              data={Object.keys(BusinessType).map((item) => ({
                value: item,
                label: BusinessType[item as keyof typeof BusinessType],
              }))}
              disabled
            />
          </Grid.Col>

          <Grid.Col span={gridSpan}>
            <TextInput
              label={t("tax_id")}
              defaultValue={profile?.taxId}
              disabled
            />
          </Grid.Col>
          <Grid.Col span={12}>
            <FileInput
              accept="image/png,image/jpeg"
              label={t("logo")}
              placeholder="logo.jpg"
              value={logo}
              onChange={(value) => {
                setLogo(value);
                handleFileChange(value);
              }}
              rightSection={<IconUpload stroke={"1.5px"} size={"20"}/>}
            />
          </Grid.Col>
          {imageSrc && (
            <Grid.Col span={12}>
              <Paper radius={6} p={"xl"} bd={"1px solid metal.1"}>
                <Image w={"auto"} h={rem(56)} src={imageSrc} alt="Logo" />
              </Paper>
            </Grid.Col>
          )}
          <Grid.Col span={12}>
            <CurrencySelector label={t("default_currency")} />
          </Grid.Col>
        </Grid>
      </Box>
    </>
  );
};

export default ProfileSettings;
