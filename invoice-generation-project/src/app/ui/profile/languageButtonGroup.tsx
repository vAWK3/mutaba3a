"use client";

// LanguageButtonGroup.tsx
import { Button, Group } from "@mantine/core";
import { useState } from "react";
import { Language } from "@/types";
import { fontAr, fontEn } from "../fonts";

interface LanguageButtonGroupProps {
  selectedLanguages: Language[];
  setSelectedLanguages: (lang: Language[]) => void;
}

export const LanguageButtonGroup = ({
  selectedLanguages,
  setSelectedLanguages,
}: LanguageButtonGroupProps) => {
  const handleSelect = (lang: Language) => {
    if (selectedLanguages.includes(lang)) {
      // If trying to deselect, ensure there's at least one language selected
      if (selectedLanguages.length > 1) {
        setSelectedLanguages(selectedLanguages.filter((l) => l !== lang));
      }
    } else {
      // Ensure maximum 3 selections
      if (selectedLanguages.length < 3) {
        setSelectedLanguages([...selectedLanguages, lang]);
      }
    }
  };

  return (
    <Group>
      {Object.values(Language).map((lang) => (
        <Button
          key={lang}
          fw={selectedLanguages.includes(lang) ? 500 : 400}
          className={lang == Language.ar ? fontAr.className : fontEn.className}
          variant={selectedLanguages.includes(lang) ? "light" : "default"}
          onClick={() => handleSelect(lang)}
        >
          {lang}
        </Button>
      ))}
    </Group>
  );
};
