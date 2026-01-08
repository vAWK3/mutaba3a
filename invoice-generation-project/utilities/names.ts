import { Address } from "@/types";

export const getNameWithLanguage = ({ language, ar, en, he }: {
    language: string; ar?: string; he?: string; en?: string;
}):
    string => {

    switch (language) {
        case "en":
            return en ?? ar ?? he!;
        case "ar":
            return ar ?? en ?? he!;
        case "he":
            return he ?? ar ?? en!;
    }

    return 'name';

}

export const hasOneAddress = ({ address, key }: { address: Address, key: "country" | "city" | "address" }): boolean => {

    switch (key) {
        case "city":
            if (address.cityAr) return true;

            if (address.cityHe) return true;

            if (address.cityHe) return true;
            break;

        case "country":
            if (address.countryAr) return true;

            if (address.countryHe) return true;

            if (address.countryHe) return true;
            break;

        case "address":
            if (address.address1Ar) return true;

            if (address.address1He) return true;

            if (address.address1He) return true;
            break;
    }



    return false;
}