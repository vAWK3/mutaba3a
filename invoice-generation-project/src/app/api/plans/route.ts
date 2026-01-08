import { generatePlan, generatePlans } from "../../../../utilities/mock";





export async function GET(request: Request) {

  const { searchParams } = new URL(request.url);

  const user = searchParams.get('user');

  const data = user ? generatePlan() : generatePlans();

  console.log('generated data is ', data);

  return Response.json(data);
}