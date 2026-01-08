import { Params } from "next/dist/shared/lib/router/utils/route-matcher";
import { NextResponse } from "next/server";
import { apiGet } from "../../api";
import { getInvoicesAsPercentage, getInvoiceTotals, getMonthName } from "../../../../../utilities/mock";



function formatDate(date: Date): string {
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0'); // Months are 0-indexed
    return `${day}/${month}`;
};

const getAnalytics = async (user: string) => {
    if (!user) {
        return new NextResponse(JSON.stringify({ error: 'User parameter is required' }), {
            status: 400, // or 400 depending on the case
            headers: {
                'Content-Type': 'application/json',
            },
        });
    }


    try {

        const analytics = await apiGet(`api/v1/analytics/${user}/`);

        if (analytics.statusText !== "OK") {
            return new Response(JSON.stringify({ error: analytics.statusText }), {
                status: analytics.status, // or 400 depending on the case
                headers: {
                    'Content-Type': 'application/json',
                },
            });
        }

        return NextResponse.json(analytics.data);
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


export async function GET(request: Request, context: { params: Params }) {

    console.log('***** GETTING FROM ANALYTICS ****');

    const business = context.params.business

    const { searchParams } = new URL(request.url);

    const period = searchParams.get('period');
    const percent = searchParams.get('percent');
    const type = searchParams.get('type');


    const should_use_local_dev = process.env.SHOULD_USE_LOCAL_DEV

    if (should_use_local_dev === 'true') {

        console.log('***** GETTING ANALYTICS APIPI ****');

        const data = await getAnalytics(business as string);
        console.log('data is ', data);
        const results = await data.json();
        return NextResponse.json(results);
    }


    let key = '';
    let length = 0;
    const data = [];

    console.log('****** GETTING ANALYTICS FOR *****\nbusiness:\n ', business);

    if (period === '30D') {
        key = 'day';
        length = 30;


        if (percent === 'true') {
            data.push(getInvoicesAsPercentage(30));
        } else if (type === "invoice") {
            data.push(getInvoiceTotals(5000))
        } else {

            for (let i = 0; i < length; i++) {
                const date = new Date();
                date.setDate(date.getDate() - i); // Subtract days from current date

                const values = {
                    Overdue: Math.random() > 0.3 ? 0 : Math.floor(Math.random() * 50),
                    Paid: Math.floor(Math.random() * 100),
                    Pending: Math.floor(Math.random() * 100),
                };
                data.push({
                    [key]: formatDate(date),
                    ...values,
                });
            }
        }
    } else if (period === '6M') {
        key = 'month';
        length = 6;

        if (percent === 'true') {
            data.push(getInvoicesAsPercentage(180));
        } else if (type === "invoice") {
            data.push(getInvoiceTotals(30000))
        } else {

            for (let i = 0; i < length; i++) {
                const date = new Date();
                date.setMonth(date.getMonth() - i); // Subtract months from current date

                const values = {
                    Overdue: Math.floor(Math.random() * 1000),
                    Paid: Math.floor(Math.random() * 2000),
                    Pending: Math.floor(Math.random() * 1000),
                };
                data.push({
                    [key]: getMonthName(date),
                    ...values,
                });

            }
        }
    } else if (period === 'YTD' || period === '1Y') {
        key = 'quarter';
        length = 4;

        if (percent === 'true') {
            data.push(getInvoicesAsPercentage(300));
        } else if (type === "invoice") {
            data.push(getInvoiceTotals(60000))
        } else {

            for (let i = 0; i < length; i++) {
                const date = new Date();
                date.setMonth(date.getMonth() - i * 3); // Subtract quarters (3 months) from current date
                const quarter = `Q${4 - i}/${date.getFullYear().toString().slice(2)}`;
                const values = {
                    Overdue: Math.floor(Math.random() * 1000),
                    Paid: Math.floor(Math.random() * 7000),
                    Pending: Math.floor(Math.random() * 2000),
                };
                data.push({
                    [key]: quarter,
                    ...values,
                });


            }
        }
    } else {
        return new Response(JSON.stringify({ error: 'Invalid period query' }), {
            status: 400, // or 400 depending on the case
            headers: {
                'Content-Type': 'application/json',
            },
        });

    }

    //TODO: update this

    return NextResponse.json(data);
}