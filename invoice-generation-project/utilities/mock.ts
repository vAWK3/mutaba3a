import { BusinessType, ClientData, Currency, DocumentData, DocumentItem, DocumentStatus, FaturaPlan, IssuedDocumentType, ProfileData, SubscriptionPlan } from "@/types";

export function getRandomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function getRandomDate({ minYear, maxYear, daysAgo, daysFuture }: { minYear?: number, maxYear?: number, daysAgo?: number, daysFuture?: number }): Date {

    if (daysAgo && daysFuture) {
        const today = new Date();
        const minDate = new Date(today);
        minDate.setDate(today.getDate() - daysAgo);
        const maxDate = new Date();
        minDate.setDate(today.getDate() + daysFuture); // 7 days ago

        return new Date(minDate.getTime() + Math.random() * (maxDate.getTime() - minDate.getTime()));
    }

    if (minYear && maxYear) {
        const year = getRandomInt(minYear, maxYear);
        const month = getRandomInt(0, 11); // JavaScript months are 0-based (0 = January, 11 = December)

        // Get the number of days in the month
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const day = getRandomInt(1, daysInMonth);

        return new Date(year, month, day);
    }

    const today = new Date();
    const minDate = new Date(today);
    minDate.setDate(today.getDate() - 14); // 14 days ago
    const maxDate = new Date(today);
    maxDate.setMonth(today.getMonth() + 1); // 1 month from now

    return new Date(minDate.getTime() + Math.random() * (maxDate.getTime() - minDate.getTime()));

}

export function getRandomDueDate(): Date {
    const today = new Date();
    const minDate = new Date(today);
    minDate.setDate(today.getDate() - 14); // 14 days ago
    const maxDate = new Date(today);
    maxDate.setMonth(today.getMonth() + 1); // 1 month from now

    return new Date(minDate.getTime() + Math.random() * (maxDate.getTime() - minDate.getTime()));
}

export function getRandomItems(): DocumentItem[] {
    const items = [
        { name: "Consulting Service", rate: 150 },
        { name: "Design Work", rate: 200 },
        { name: "Development Work", rate: 250 },
        { name: "SEO Service", rate: 100 },
        { name: "Social Media Management", rate: 120 },
    ];

    const numberOfItems = getRandomInt(2, 5);
    const selectedItems = [];

    for (let i = 0; i < numberOfItems; i++) {
        const item = items[Math.floor(Math.random() * items.length)];
        const quantity = getRandomInt(1, 10);

        selectedItems.push({
            name: item.name,
            quantity,
            rate: item.rate,
            rateVat: item.rate * 0.17,
            discount: Math.random() > 0.5 ? (item.rate * 0.3) : 0,
            taxExempt: false,
        });
    }

    return selectedItems;
}

export function getRandomNotes(): string {
    const notes = [
        "Please make payment within 30 days.",
        "Thank you for your business!",
        "Payment due upon receipt.",
        "Late payments may be subject to fees.",
        "Contact us for any questions regarding this invoice.",
        "This credit note can be applied to your next invoice.",
        "Please refer to this credit note number when making a claim.",
        "Issued for returned goods.",
        "We apologize for any inconvenience caused.",
        "Contact us if you have any questions regarding this credit note."
    ];



    return Math.random() > 0.5 ? notes[Math.floor(Math.random() * notes.length)] : "";
}

// Helper function to generate a unique ID
const generateUniqueId = (): string => {
    return `${Math.random().toString(36).substring(2, 9)}`;
};

const generateTaxId = (): string => {
    return `${Math.random().toString(36).substring(0, 9)}`;
};

// Helper function to generate a client number
const generateClientNumber = (index: number): string => {
    return `${index.toString().padStart(5, '0')}`;
};

// Helper function to generate a random client name
const generateClientName = (): string => {
    const names = [
        "Kerning Cultures",
        "Arab Reform Initiative",
        "Oasis500",
        "Al Jazeera",
        "Rotana",
        "MBC Group",
        "Sky News Arabia",
        "Emirates Airlines",
        "Dubai Media Corporation",
        "Sharjah Media",
    ];
    return names[Math.floor(Math.random() * names.length)];
};

export const generateRandomEmail = (name: string): string => {
    const domains = ['gmail.com', 'outlook.com', 'yahoo.com'];
    const randomDomain = domains[Math.floor(Math.random() * domains.length)];
    const sanitizedUser = name.toLowerCase().replace(/\s+/g, '');
    return `${sanitizedUser}@${randomDomain}`;
};

export const generateRandomAddress = (): string => {
    const streetNames = ['Hizma St', 'Bab Hutta', 'Nablus Road', 'Beit Hanina St.', 'Az Zahra St.'];
    const cities = ['Jerusalem', 'Ramallah', 'Bethlehem', 'Haifa', 'Nazareth'];
    const zipCode = Math.floor(10000 + Math.random() * 90000).toString();

    const street = streetNames[Math.floor(Math.random() * streetNames.length)];
    const city = cities[Math.floor(Math.random() * cities.length)];
    const streetNumber = Math.floor(Math.random() * 1000) + 1;

    return `${streetNumber} ${street}\n${city}, ${zipCode}`;
};

function getPreviousDate(daysAgo: number): Date {
    const today = new Date();
    const minDate = new Date(today);
    minDate.setDate(today.getDate() - daysAgo); // 7 days ago
    const maxDate = new Date(today);

    return new Date(minDate.getTime() + Math.random() * (maxDate.getTime() - minDate.getTime()));
}

// Client generator function
export const generateClients = (numberOfClients: number, period?: string): ClientData[] => {
    const clients: ClientData[] = [];
    const currencies = [Currency.Dollar, Currency.Shekel];
    const colors = ['yellow', 'blue', 'green', 'cyan', 'metal'];

    for (let i = 0; i < numberOfClients; i++) {
        const id = generateUniqueId();
        const clientNumber = generateClientNumber(i + 1);
        const name = generateClientName();
        const outstandingInvoices = parseFloat((Math.random() * (period == "30D" ? 500 : period == "6M" ? 1200 : 3000)).toFixed(2)); // Random amount up to $10,000
        const totalDocuments = Math.floor(Math.random() * (period == "30D" ? 3 : period == "6M" ? 6 : 9)) + 1; // Random number of documents between 1 and 100
        const currency = currencies[Math.floor(Math.random() * currencies.length)];
        const color = colors[Math.floor(Math.random() * colors.length)];


        const email = generateRandomEmail(name);

        const lastContact = getPreviousDate(60);

        const client: ClientData = {
            id,
            name,
            color: color,
            refNumber: clientNumber,
            data: {
                lastContactDate: lastContact,
                numberOfDocuments: totalDocuments,
                outstandingInvoices,
            },
            document: { currency, },
            email: email,
            address: {
                address1En: generateRandomAddress()
            },
            businessProfile: 123,
        };

        clients.push(client);
    }

    return clients;
};

export const generateDocuments = (count: number, oneClient: boolean, period?: string): DocumentData[] => {
    const clients: ClientData[] = generateClients(oneClient ? 1 : 10, period);

    const subjects = [
        "Social Media Posts",
        "January Work",
        "February Work",
        "March Work",
        "Website Redesign",
        "Mobile App Development",
        "SEO Optimization",
        "Marketing Campaign",
        "Logo Design",
        "Video Production"
    ];

    const types = [IssuedDocumentType.Invoice, IssuedDocumentType.Receipt, IssuedDocumentType.InvoiceReceipt, IssuedDocumentType.CreditNote];
    const statuses = [DocumentStatus.Paid, DocumentStatus.Pending, DocumentStatus.Overdue];
    const currencies = [Currency.Dollar, Currency.Shekel];

    const documents: DocumentData[] = [];


    for (let i = 0; i < count; i++) {
        const number = (10045 + i).toString();
        const subject = subjects[Math.floor(Math.random() * subjects.length)];
        const client = clients[Math.floor(Math.random() * clients.length)];
        const type = types[Math.floor(Math.random() * types.length)];

        const issueDate = getRandomDate({ minYear: 2018, maxYear: 2023 }); const dueDate = getRandomDueDate();

        const items = getRandomItems();
        const subtotal = items.reduce((sum, item) => sum + item.quantity * item.rateVat, 0);

        const discountRate = Math.random() <= 0.3 ? Math.random() * 0.2 : 0; // 30% chance for up to 20% discount
        const discount = subtotal * discountRate;

        const tax = Math.random() > 0.5 ? 17 : 0; // 50% chance of 17% tax
        const currency = currencies[Math.floor(Math.random() * currencies.length)];
        const total = (subtotal - discount) * (1 + tax / 100);
        const status = statuses[Math.floor(Math.random() * statuses.length)];

        const notes = getRandomNotes();

        documents.push({
            number,
            subject,
            client,
            type,
            issueDate,
            dueDate,
            items,
            subtotal,
            discount,
            tax,
            total,
            status,
            notes,
            settings: { currency },
        });
    }

    console.log('documents is ', documents[0]);

    return documents;
};

// Client generator function
export const generatePlan = (): SubscriptionPlan => {

    const faturaPlan = generatePlans()[Math.random() > 0.5 ? 0 : 1];

    const plan: SubscriptionPlan = {
        id: generateUniqueId(),
        startDate: getRandomDate({ daysAgo: 300, daysFuture: -180 }),
        endDate: getRandomDate({ daysAgo: 0, daysFuture: 180 }),
        isActive: Math.random() > 0.5,
        currentDocs: faturaPlan.nameEn == "free" ? (Math.floor(Math.random() * 4) + 1) : (Math.floor(Math.random() * 100) + 1),
        plan: faturaPlan,
        discount: 0
    }

    return plan;
};

export const generatePlans = (): FaturaPlan[] => {

    const name = Math.random() > 0.5 ? "free" : "unlimited";
    const nameAr = name === "free" ? "مجاني" : "كامل";

    return [
        {
            id: generateUniqueId(),
            nameEn: "Unlimited",
            nameAr: "كامل",
            price: 18,
            maxDocs: 0,
            maxClients: 0,
            analytics: true,
            importExport: true,
            invoiceCustomization: true,
        }, {
            id: generateUniqueId(),
            nameEn: "Free",
            nameAr: "مجاني",
            price: 0,
            maxDocs: 5,
            maxClients: 3,
            analytics: false,
            importExport: false,
            invoiceCustomization: false
        }
    ]

};


export const generateBusinessProfiles = () => {
    const profiles: ProfileData[] = [];

    const profile1: ProfileData = {
        id: 1,
        userId: generateUniqueId(),
        nameEn: "Ahmad Salhab",
        nameAr: "أحمد سلهب",
        nameHe: "אחמד סלהב",
        address: {
            address1En: "123 Sheikh Jarrah St, alQuds",
            address1Ar: "123 شارع الشيخ جرّاح، القدس",
            address1He: "123 רחוב שייח גראח, אלקודס",
        },
        color: "green",
        email: "ahmad@elmokhtbr.com",
        taxId: "209284791",
        phoneNumber: "+972-54-912-0101",
        businessType: BusinessType.EXEMPT,
        logoUrl: "https://picsum.photos/200"
    };

    const profile2: ProfileData = {
        id: 2,
        userId: generateUniqueId(),
        nameEn: "Designer Salhab",
        nameAr: "Designer Salhab",
        nameHe: "Designer Salhab",
        address: {
            address1En: "456 Beta Ave, Los Angeles, CA 90001",
            address1Ar: "456 شارع بيتا، لوس أنجلوس، CA 90001",
            address1He: "ביתא אווניו 456, לוס אנג'לס, CA 90001"
        },
        email: "info@beta-solutions.com",
        taxId: "US987654321",
        phoneNumber: "+1 555-987-6543",
        businessType: BusinessType.AUTHORIZED,
        logoUrl: "https://example.com/logos/beta.png",
        color: "green"
    };

    const profile3: ProfileData = {
        id: 3,
        userId: generateUniqueId(),
        nameEn: "elMokhtbr",
        nameAr: "المختبر",
        nameHe: "المختبر",
        address: {
            address1En: "789 Gamma Blvd, Chicago, IL 60601",
            address1Ar: "789 بوليفارد جاما، شيكاغو، IL 60601",
            address1He: "גמא בולווארד 789, שיקגו, IL 60601"
        },
        email: "support@gamma-enterprises.com",
        taxId: "US192837465",
        phoneNumber: "+1 555-192-8374",
        businessType: BusinessType.NONE,
        logoUrl: "https://example.com/logos/gamma.png",
        color: "metal"
    };

    ;

    return [profile1, profile2, profile3];
};

export const getMonthName = (date: Date): string => {
    const monthNames = [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
    ];
    return monthNames[date.getMonth()];
}

export const generateRandomValues = (docs: number) => {
    const Overdue = Math.floor(Math.random() * (docs * 0.1));
    const Pending = Math.floor(Math.random() * (docs * 0.3));
    const Paid = Overdue + Pending + Math.floor(Math.random() * docs) + 1; // Ensure Paid > Overdue + Pending
    return { Paid: Paid, Pending: Pending, Overdue: Overdue, Invoiced: Paid + Pending + Overdue, };
};


export const getInvoicesAsPercentage = (docs: number) => {
    const values = generateRandomValues(docs);
    return values;
}

export const getInvoiceTotals = (amount: number) => {
    const values = generateRandomValues(amount);
    return {
        Invoiced: {
            amount: values.Overdue + values.Paid + values.Pending,
            trend: Math.random() * 0.3,
        },
        Overdue: {
            amount: values.Overdue,
            trend: Math.random() * -0.1,
        },
        Paid: {
            amount: values.Paid,
            trend: Math.random() * 0.2,
        },
        Pending: {
            amount: values.Pending,
            trend: Math.random() * -0.1,
        }

    };
}