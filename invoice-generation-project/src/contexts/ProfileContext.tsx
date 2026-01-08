"use client";

import { makeGetRequest } from "@/app/api/api";
import { ProfileData } from "@/types";
import { useUser } from "@auth0/nextjs-auth0/client";
import { redirect } from "next/dist/server/api-utils";
import { createContext, ReactNode, useEffect, useState } from "react";
import { toCamelCase } from "../../utilities/drf";

interface ProfileContextProps {
  profiles: ProfileData[];
  activeProfile?: ProfileData;
  isLoading: boolean;
  error?: string;
  chooseProfile: (profile: ProfileData) => void;
  clearProfile: () => void;
}

export const ProfileContext = createContext<ProfileContextProps | undefined>(
  undefined
);

export const ProfileProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useUser();
  const [profiles, setProfiles] = useState<ProfileData[]>([]);
  const [activeProfile, setActiveProfile] = useState<ProfileData | undefined>();
  const [isLoading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    setLoading(true);

    // if (!user || !user.sub) {
    //   setError("user not found");
    //   return;
    // } else {
    //   setError(undefined);
    // }

    // makeGetRequest(`/api/profile?user=${user.sub}`)
    makeGetRequest(`/api/profile?user=1`)
      .then((data) => {
        setLoading(false);
        if (data.results) {
          setError(undefined);
          const camelized = toCamelCase(data.results);
          setProfiles(camelized);
        }
      })
      .catch((err) => {
        setLoading(false);
        setError(err);
        console.error("Error fetching profiles:", err);
      });
  }, [user]);

  const chooseProfile = (profile: ProfileData) => {
    console.log("setting chosen profile is ", profile);
    setActiveProfile(profile);
  };

  const clearProfile = () => setActiveProfile(undefined);

  return (
    <ProfileContext.Provider
      value={{
        profiles,
        isLoading,
        error,
        activeProfile,
        chooseProfile,
        clearProfile,
      }}
    >
      {children}
    </ProfileContext.Provider>
  );
};

export default ProfileProvider;
