import { getToken } from "../auth/[auth0]/auth0";

export async function GET(request: Request) {
  return Response.json({
    email: "ahmad@elmokhtbr.com",
    full_name: "Ahmad Salhab",
    id: "2075072321",
  });
}

// export const getPermissions = async (userId: string) => {
//   const authToken = process.env.AUTH0_API_TOKEN;
//   const headers = new Headers();
//   const token = await getToken()
//   if (!token) {
//     return []
//   }
//   headers.append("Accept", "application/json");
//   headers.append("Authorization", `Bearer ${token.access_token}`);
//   try {
//     const res = await fetch(
//       `https://elmokhtbr.eu.auth0.com/api/v2/users/${userId}/roles`,
//       {
//         method: "GET",
//         headers,
//         redirect: "follow",
//       }
//     );
//     if (!res.ok) {
//       console.error(`Faild to get permissions: ${res.statusText}`)
//       return []
//     }
//     const data = await res.json();
//     console.log('permission data is ', data);
//     return data;
//   } catch {
//     console.error({ error: "Failed to fetch data" });
//   }
// };
