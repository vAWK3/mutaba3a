import { Currency, UpdateModel } from "@/types";

export async function createClient(reqData: any): Promise<ApiResponse> {

    const config = {
        method: "POST",
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(reqData),
    }

    const baseUrl = process.env.NEXT_PUBLIC_API_URL; // Use the environment variable
    const res = await fetch(`${baseUrl}/api/clients/create`, config);

    console.log('res is ', res);

    let error;

    if (!res.ok) {
        error = `API request failed with status ${res.status}`;
        // throw new Error(`API request failed with status ${res.status}`);
    }
    const data = await res.json();

    console.log('data is ', data);

    return {
        success: res.ok,
        error: error,
        data: data,
    };
}

export async function fetchUpdates(): Promise<UpdateModel[]> {
    const baseUrl = process.env.NEXT_PUBLIC_API_URL; // Use the environment variable
    const res = await fetch(`${baseUrl}/api/updates`);
    const data = await res.json();
    return data;
};


export async function createProfile(reqData: any): Promise<ApiResponse> {

    const config = {
        method: "POST",
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(reqData),
    }

    const baseUrl = process.env.NEXT_PUBLIC_API_URL; // Use the environment variable
    const res = await fetch(`${baseUrl}/api/profile/create`, config);

    if (!res.ok) {
        throw new Error(`API request failed with status ${res.status}`);
    }
    const data = await res.json();

    console.log('data is ', data);

    return {
        success: false,
    };
}

// export async function fetchAnalytics(period: string, percent: boolean) {
//     const baseUrl = process.env.NEXT_PUBLIC_API_URL; // Use the environment variable
//     const response = await fetch(`${baseUrl}/api/analytics/${userId}/?period=${period}&percent=${percent}`);
//     const data = await response.json();
//     return data;
// }

export async function fetchClients(period: string) {
    const baseUrl = process.env.NEXT_PUBLIC_API_URL; // Use the environment variable
    const response = await fetch(`${baseUrl}/api/clients?period=${period}`);

    const data = await response.json();

    return data;
}

export async function fetchDocuments(period?: string) {
    const baseUrl = process.env.NEXT_PUBLIC_API_URL; // Use the environment variable
    const response = await fetch(`${baseUrl}/api/documents?period=${period}`);

    const data = await response.json();

    return data;
}

// export async function fetchInvoiceData(period: string) {
//     const baseUrl = process.env.NEXT_PUBLIC_API_URL; // Use the environment variable
//     const response = await fetch(`${baseUrl}/api/analytics?period=${period}&percent=false&type=invoice`);

//     const data = await response.json();

//     return data;
// }

export async function getExchangeRate(baseCurrency: Currency) {
    const host = "api.frankfurter.app";

    const fromCurrency = baseCurrency == Currency.Dollar ? "USD" : "ILS";
    const toCurrency = baseCurrency == Currency.Dollar ? "ILS" : "USD";

    const response = await fetch(
        `https://${host}/latest?amount=1&from=${fromCurrency}&to=${toCurrency}`
    );

    const data = await response.json();


    if (data) {
        return baseCurrency == Currency.Dollar ? data.rates.ILS : data.rates.USD;
    }
};