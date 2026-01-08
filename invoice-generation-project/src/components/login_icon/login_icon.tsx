import { Avatar, Flex, Space, Box, Paper } from "@mantine/core";
import { getInitials } from "../../../utilities/formatters";
import { MultilingualString } from "../../../models/enums/multilingual_string";
// import { useState } from "react";
import styles from "./login_icon.module.css";
import { ProfileData } from "@/types";

interface LoginIconProps {
  profile: ProfileData;
  language: string;
  onTap?: Function;
}

export default function LoginIcon({
  profile,
  language,
  onTap,
}: LoginIconProps) {
  const name = {
    en: profile.nameEn,
    ar: profile.nameAr,
    he: profile.nameHe,
  };

  const avatar = (
    <Avatar
      color={profile.color ? profile.color : "green"}
      radius="lg"
      size="xl"
      fz={"xl"}
      fw={"400"}
    >
      {getInitials(name[language as keyof MultilingualString] ?? name.en)}
    </Avatar>
  );

  return (
    <Paper
      onClick={onTap != undefined ? (e) => onTap() : () => { }}
      className={`${styles.item} hover:bg-gray-100`}
      radius={"lg"}
      px="xl"
      py="lg"
    >
      <Flex visibleFrom="sm" direction="column" ta={"center"} align={"center"}>
        {avatar}
        <Space h={"lg"} w={"lg"} />
        {name[language as keyof MultilingualString] ?? name.en}
      </Flex>
      <Flex hiddenFrom="sm" direction="row" ta={"center"} align={"center"}>
        {avatar}
        <Space h={"lg"} w={"lg"} />
        {name[language as keyof MultilingualString] ?? name.en}
      </Flex>
    </Paper>
  );
}
