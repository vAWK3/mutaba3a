import { FaturaPlan, SubscriptionPlan } from "@/types";
import { Dispatch, SetStateAction, useEffect, useState } from "react";

export function usePlan(userId: string): {
  plan: SubscriptionPlan | undefined;
  setPlan: Dispatch<SetStateAction<SubscriptionPlan | undefined>>;
} {
  const [plan, setPlan] = useState<SubscriptionPlan>();

  useEffect(() => {
    const fetchPlans = async () => {
      const response = await fetch(`/api/plans?user=${userId}`);

      console.log("response from api plans is ", response);

      const data = await response.json();

      console.log("data is ", data);

      setPlan(data);
    };

    fetchPlans();
  }, [userId]);

  return { plan, setPlan };
}

export function usePlans(): {
  plans: FaturaPlan[] | undefined;
  setPlans: Dispatch<SetStateAction<FaturaPlan[] | undefined>>;
} {
  const [plans, setPlans] = useState<FaturaPlan[]>();

  useEffect(() => {
    const fetchPlans = async () => {
      const response = await fetch("/api/plans");

      const data = await response.json();

      setPlans(data);
    };

    fetchPlans();
  }, []);

  return { plans, setPlans };
}
