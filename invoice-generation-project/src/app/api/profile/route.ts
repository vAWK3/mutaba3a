
import { NextResponse } from "next/server";
import { generateBusinessProfiles } from "../../../../utilities/mock";
import { apiGet, apiPost } from "../api";


const getProfile = async (user: string) => {
  if (!user) {
    return new NextResponse(JSON.stringify({ error: 'User parameter is required' }), {
      status: 400, // or 400 depending on the case
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  try {

    const profiles = await apiGet(`api/v1/business`);

    console.log('********* PROFILE/ROUTE****** profiles from API GET is ', profiles);

    if (profiles.statusText !== "OK") {
      return new Response(JSON.stringify({ error: profiles.statusText }), {
        status: profiles.status, // or 400 depending on the case
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }

    console.log('profiles is ', profiles.data);

    return NextResponse.json(profiles.data);
  } catch (error) {
    console.error("Error fetching profiles:", error);

    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, // or 400 depending on the case
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }
};


export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const user = searchParams.get('user');

  const should_use_local_dev = process.env.SHOULD_USE_LOCAL_DEV
  if (!user) {
    return new Response(JSON.stringify({ error: 'User parameter is required' }), {
      status: 400, // or 400 depending on the case
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  if (should_use_local_dev === 'true') {


    console.log('***** IN GET PROFILE **** \n\n\n user is ', user);

    const data = await getProfile(user as string);

    const results = await data.json();

    //** TODO: remove this  */

    // if (results.count == 0) {
    //   console.log("*** IN GET PROFILE NO COUNT *** ");
    //   results.count = 3;
    //   results.results = generateBusinessProfiles();
    // }
    //** END REMOVE */


    console.log("*** IN GET PROFILE RESULTS *** ", results);

    return NextResponse.json(results);
  }

  const profiles = generateBusinessProfiles();

  return NextResponse.json({
    count: 0,
    results: profiles,
  });
}

export async function POST(request: Request) {


  console.log('request is ', request);

  try {

    const reqData = await request.json();

    console.log('request json is ', reqData);

    const profiles = await apiPost('/api/v1/business/create', reqData);

    console.log('got it from profiles with data ', profiles);;

    if (profiles.status !== 201) {
      return NextResponse.error();
    }

    console.log('AFTER GETTING EVERYTHIGN ***** \n\n\n data is ', profiles.data);

    return NextResponse.json(profiles.data);
  } catch (error) {
    console.error("Error creating profile:", error);

    return NextResponse.error();
  }
};