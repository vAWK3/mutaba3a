import { useState } from "react";

interface FormHandler<T> {
  formData: T;
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleNamelessChange: (field: string, value: string | null) => void;
  setFormData: React.Dispatch<React.SetStateAction<T>>;
}

export function useFormHandler<T>(initialState: T): FormHandler<T> {
  const [formData, setFormData] = useState<T>(initialState);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, files } = e.target;

    const nameParts = name.split(".");

    setFormData((prevFormData) => {
      if (nameParts.length > 1) {
        // Update nested object
        const [parent, child] = nameParts;
        return {
          ...prevFormData,
          [parent]: {
            ...(prevFormData as any)[parent],
            [child]: files ? files[0] : value,
          },
        };
      } else {
        return {
          ...prevFormData,
          [name]: files ? files[0] : value,
        };
      }
    });
  };

  const handleNamelessChange = (field: string, value: string | null) => {
    setFormData((prevFormData) => ({
      ...prevFormData,
      [field]: value,
    }));
  };

  return { formData, handleInputChange, handleNamelessChange, setFormData };
}
