"use client";

import { Flex, Button, Text, PinInput, rem } from "@mantine/core";
import LoginIcon from "./login_icon";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import BackButton from "../buttons/back_button";
import { ProfileData } from "@/types";
import useNavigateToPage from "../../../utilities/navigation";

interface ProfileSelectionProps {
  profiles: ProfileData[];
  chooseProfile: (profile: ProfileData) => void;
}

export default function ProfileSelection({
  profiles,
  chooseProfile,
}: ProfileSelectionProps) {
  const [selectedProfile, setSelectedProfile] = useState<ProfileData>();
  const [error, setError] = useState(false);
  const locale = useLocale();
  const { navigateToPage } = useNavigateToPage();

  const t = useTranslations("Login");

  const handleChange = (value: string) => {
    //TODO: update to setup pin code and verify pin code
    if (selectedProfile && value === "1111") {
      chooseProfile(selectedProfile);
      navigateToPage('dashboard');
    } else if (value.length === 4) {
      setError(true);
    } else if (value.length === 0 || value.length === 1) {
      setError(false);
    }
  };

  const icons = profiles.map((item, index) => {
    return (
      <LoginIcon
        key={`${item.id}_${index}`}
        profile={item}
        language={locale}
        onTap={() => setSelectedProfile(item)}
      />
    );
  });

  return selectedProfile == undefined ? (
    <div>
      <Flex hiddenFrom="sm" gap={0} direction={"column"}>
        {icons}
      </Flex>
      <Flex visibleFrom="sm" direction={"row"}>
        {icons}
      </Flex>
    </div>
  ) : (
    <Flex direction={"column"} align="center">
      <LoginIcon profile={selectedProfile} language={locale} />
      <Text c="dimmed">{t("enter_pin")}</Text>
      <PinInput
        my={"xl"}
        size="xl"
        type={"number"}
        mask
        autoFocus
        error={error}
        onChange={(value) => handleChange(value)}
      />

      <BackButton
        variant="outline"
        onClick={() => setSelectedProfile(undefined)}
      />
    </Flex>
  );
}
