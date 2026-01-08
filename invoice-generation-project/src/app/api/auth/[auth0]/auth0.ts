export const getToken = async() => {
    const url = process.env.AUTH0_TOKEN_URL
    if (!url) {
        return
    }
    const data = {
        method: 'POST',
        headers: {
            'content-type': 'application/json'
        },
        body: JSON.stringify({
            "client_id": process.env.AUTH0_TOKEN_CLIENT_ID,
            "audience": process.env.AUTH0_TOKEN_AUDIENCE,
            "client_secret": process.env.AUTH0_TOKEN_SECRET,
            "grant_type":"client_credentials",
        })
    }
    try {
        const res = await fetch(url, data);
    
        if (!res.ok) {
          throw new Error(`Failed to fetch token: ${res.statusText}`);
        }
    
        const tokenData = await res.json();
        return tokenData;
      } catch (error) {
        console.error('Error fetching token:', error);
        throw error;
      }
}