import axios, { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { toSnakeCase } from '../../../utilities/drf';


const apiClient = axios.create({
    baseURL: `${process.env.BACKEND_URL}`,
    timeout: 10000,
    headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    },
});

// GET request
export const apiGet = async <T>(endpoint: string, params: Record<string, any> = {}): Promise<AxiosResponse> => {
    try {
        const response: AxiosResponse<T> = await apiClient.get(endpoint, { params });

        console.log('*** RESPONSE API GET ***\n\n\n', response);

        return response;
    } catch (error) {
        console.error('API GET Error:', error);
        throw error;
    }
};

// POST request
export const apiPost = async <T>(endpoint: string, data: T, options = {}): Promise<AxiosResponse> => {
    try {
        console.log('*** POSTING ***')
        console.log('endpoint ', endpoint);
        console.log('data is ', data);
        const response: AxiosResponse<T> = await apiClient.post(endpoint, data, options);
        console.log('response is  ', response);

        // console.log(response.data)
        return response;
    } catch (error: any) {
        console.error('API POST Error:', error);
        throw error;
    }
};

// PUT request
export const apiPut = async <T>(endpoint: string, data: T, options = {}): Promise<AxiosResponse> => {
    try {
        const response: AxiosResponse<T> = await apiClient.put(endpoint, data, options);
        return response;
    } catch (error) {
        console.error('API PUT Error:', error);
        throw error;
    }
};
// PATCH request
export const apiPATCH = async <T>(endpoint: string, data: T, options = {}): Promise<AxiosResponse> => {
    try {
        const response: AxiosResponse<T> = await apiClient.patch(endpoint, data, options);
        return response;
    } catch (error) {
        console.error('API PATCH Error:', error);
        throw error;
    }
};

// DELETE request
export const apiDelete = async <T>(endpoint: string, options = {}): Promise<AxiosResponse> => {
    try {
        const response: AxiosResponse<T> = await apiClient.delete(endpoint, options);
        return response;
    } catch (error) {
        console.error('API DELETE Error:', error);
        throw error;
    }
};

const makeRequest = async (method: string, url: string, reqData?: any) => {
    const baseUrl = process.env.NEXT_PUBLIC_API_URL;
    const config: any = {
        method,
        headers: {
            'Content-Type': reqData ? 'application/json' : undefined,
        },
        body: reqData ? JSON.stringify(toSnakeCase(reqData)) : undefined,
    };

    console.log('req data is ', reqData);

    try {
        console.log("*** MAKING API REQUEST ***");
        console.log(`endpoint is ${baseUrl}${url}`);
        console.log("configs are ", config);

        const res = await fetch(`${baseUrl}${url}`, config);

        console.log('API request is ', res);

        console.log('res ok is ', res.ok);
        console.log('status is ', res.status);



        if (!res.ok) {
            throw new Error(`API request failed with status ${res.status}`);
        }



        const data = await res.json();
        console.log('returning DATAA', data);
        console.log('Response data:', data);
        return data;
    } catch (error) {
        console.error('Error making request:', error);
        throw error;
    }
};

// POST request
export const makePostRequest = (url: string, reqData: any) =>
    makeRequest('POST', url, reqData);

// PUT request
export const makePutRequest = (url: string, reqData: any) =>
    makeRequest('PUT', url, reqData);

// PATCH request
export const makePatchRequest = (url: string, reqData: any) =>
    makeRequest('PATCH', url, reqData);

// DELETE request
export const makeDeleteRequest = (url: string) =>
    makeRequest('DELETE', url);

// GET request (No reqData needed)
export const makeGetRequest = (url: string) =>
    makeRequest('GET', url);