import { generateClients } from "../../../../../utilities/mock";
import { apiGet, apiPost } from "../../api";



const getClients = async (id: string) => {
  try {
    const clients = await apiGet(`api/v1/client/profile/${id}/`);
    if (clients.statusText !== "OK") {
      return new Response(JSON.stringify({ error: clients.statusText, problem: 'donno' }), {
        status: clients.status, // or 400 depending on the case
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }
    return Response.json(clients.data);
  } catch (error) {
    console.error("Error getting clients:", error);

    return new Response(JSON.stringify({ error: 'Internal server error', problem: 'donno2' }), {
      status: 500, // or 400 depending on the case
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }
};

export async function GET(request: Request) {

  const { searchParams } = new URL(request.url);

  const id = searchParams.get('id');
  const period = searchParams.get('period');

  const should_use_local_dev = process.env.SHOULD_USE_LOCAL_DEV

  // if (should_use_local_dev == "true") {
  return await getClients(id ?? '2');
  // }

  // const p = period == undefined ? "30D" : period as string;

  // const number = id == undefined ? p == "30D" ? 5 : p == "6M" ? 30 : 60 : 1;

  // return Response.json({ results: generateClients(number, p) });
}


export async function POST(request: Request) {

  try {
    const clients = await apiPost('/api/v1/clients/create/', request.body);

    console.log('create client result is ', clients);

    if (clients.statusText !== "OK") {

      console.log('error is ', clients.statusText);

      return new Response(JSON.stringify({ error: clients.statusText }), {
        status: clients.status, // or 400 depending on the case
        headers: {
          'Content-Type': 'application/json',
        },
      });

    }
    return Response.json(clients.data);
  } catch (error) {

    console.log('error is ', error);

    console.error("Error creating client:", error);

    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, // or 400 depending on the case
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }
};