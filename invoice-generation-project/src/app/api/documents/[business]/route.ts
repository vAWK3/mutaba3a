
import { Params } from "next/dist/shared/lib/router/utils/route-matcher";
import { AnalyticsPeriod } from "../../../../../models/enums/analytics_period";
import { parseStringToNumber } from "../../../../../utilities/formatters";
import { generateDocuments } from "../../../../../utilities/mock";

export async function GET(request: Request, context: { params: Params }) {
    console.log('request is ', request);

    const { searchParams } = new URL(request.url);

    const count = parseStringToNumber(searchParams.get('count') ?? "50")!;
    const period = searchParams.get('period') ?? AnalyticsPeriod.Months6;
    const client = searchParams.get('client');
    const recent = searchParams.get('recent');
    const profileId = context.params.business;

    console.log('**** IN GET POST OF DOCUMENTS *** \n\n\n\n\n\n');

    return Response.json({ results: generateDocuments(recent ? 5 : count, client != undefined, period) }
    )
}

//TODO: implement create document api
export async function POST(request: Request) {

    await new Promise((resolve) => setTimeout(resolve, 3000));

    const formData = request.body;
    // Return the mock document as a JSON response
    return new Response(
        JSON.stringify({
            ok: true,
            document: formData,
        }),
        {
            headers: { "Content-Type": "application/json" },
            status: 200,
        }
    );
}

