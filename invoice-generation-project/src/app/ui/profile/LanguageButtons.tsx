import { Button, Group } from "@mantine/core";
import React, { Fragment } from "react";
import { fontAr, fontEn } from "../fonts";
import { Language } from "@/types";

interface LanguageButtonGroupProps {
  shouldShowEn: boolean;
  setShouldShowEn: (shouldShow: boolean) => void;
  shouldShowAr: boolean;
  setShouldShowAr: (shouldShow: boolean) => void;
  shouldShowHe: boolean;
  setShouldShowHe: (shouldShow: boolean) => void;
}

const LanguageButtons = ({
  shouldShowEn,
  setShouldShowEn,
  shouldShowAr,
  setShouldShowAr,
  shouldShowHe,
  setShouldShowHe,
}: LanguageButtonGroupProps) => {
  return (
    <Fragment>
      <Group mb="lg">
        <Button
          fw={shouldShowAr ? 500 : 400}
          onClick={() => setShouldShowAr(!shouldShowAr)}
          className={fontAr.className}
          variant={shouldShowAr ? "light" : "default"}
        >
          {Language.ar}
        </Button>
        <Button
          fw={shouldShowEn ? 500 : 400}
          onClick={() => setShouldShowEn(!shouldShowEn)}
          className={fontEn.className}
          variant={shouldShowEn ? "light" : "default"}
        >
          {Language.en}
        </Button>
        <Button
          fw={shouldShowHe ? 500 : 400}
          onClick={() => setShouldShowHe(!shouldShowHe)}
          className={fontAr.className}
          variant={shouldShowHe ? "light" : "default"}
        >
          {Language.he}
        </Button>
      </Group>
    </Fragment>
  );
};

export default LanguageButtons;
