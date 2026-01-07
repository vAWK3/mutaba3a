export type Language = 'en' | 'ar';
export type Direction = 'ltr' | 'rtl';

export interface LanguageContextValue {
  language: Language;
  direction: Direction;
  setLanguage: (lang: Language) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

// Type for translation files structure
export interface Translations {
  common: {
    save: string;
    saving: string;
    cancel: string;
    delete: string;
    archive: string;
    add: string;
    edit: string;
    loading: string;
    search: string;
    close: string;
    confirm: string;
    noClient: string;
    noProject: string;
    all: string;
    markPaid: string;
  };
  nav: {
    overview: string;
    projects: string;
    clients: string;
    transactions: string;
    reports: string;
    settings: string;
  };
  addMenu: {
    income: string;
    expense: string;
    project: string;
    client: string;
  };
  transactions: {
    title: string;
    empty: string;
    emptySearch: string;
    emptyHint: string;
    addTransaction: string;
    searchPlaceholder: string;
    confirmDelete: string;
    type: {
      income: string;
      expense: string;
      receivable: string;
    };
    status: {
      paid: string;
      unpaid: string;
      overdue: string;
      dueIn: string;
      dueToday: string;
    };
    columns: {
      date: string;
      type: string;
      client: string;
      project: string;
      category: string;
      amount: string;
      status: string;
    };
  };
  overview: {
    title: string;
    kpi: {
      paidIncome: string;
      unpaidReceivables: string;
      expenses: string;
      net: string;
    };
    needsAttention: string;
    noAttention: string;
    recentActivity: string;
    noRecent: string;
  };
  projects: {
    title: string;
    empty: string;
    emptySearch: string;
    emptyHint: string;
    addProject: string;
    searchPlaceholder: string;
    allFields: string;
    notFound: string;
    notFoundHint: string;
    confirmArchive: string;
    columns: {
      project: string;
      client: string;
      field: string;
      paid: string;
      unpaid: string;
      expenses: string;
      net: string;
      lastActivity: string;
    };
    tabs: {
      summary: string;
      transactions: string;
    };
    detail: {
      projectDetails: string;
      noTransactions: string;
      noTransactionsHint: string;
    };
    fields: {
      design: string;
      development: string;
      consulting: string;
      marketing: string;
      legal: string;
      maintenance: string;
      other: string;
    };
  };
  clients: {
    title: string;
    empty: string;
    emptySearch: string;
    emptyHint: string;
    addClient: string;
    searchPlaceholder: string;
    notFound: string;
    notFoundHint: string;
    confirmArchive: string;
    columns: {
      client: string;
      activeProjects: string;
      paidIncome: string;
      unpaid: string;
      lastPayment: string;
      lastActivity: string;
    };
    tabs: {
      summary: string;
      projects: string;
      receivables: string;
      transactions: string;
    };
    detail: {
      clientDetails: string;
      email: string;
      phone: string;
      noProjects: string;
      noProjectsHint: string;
      noReceivables: string;
      noReceivablesHint: string;
      noTransactions: string;
      noTransactionsHint: string;
    };
    receivables: {
      dueDate: string;
      daysOverdue: string;
      action: string;
    };
  };
  reports: {
    title: string;
    exportCsv: string;
    presets: {
      thisMonth: string;
      thisYear: string;
      byProject: string;
      byClient: string;
      expensesByProject: string;
      unpaidAging: string;
    };
    sections: {
      financialSummary: string;
      incomeByProject: string;
      incomeByClient: string;
      expensesByProject: string;
      unpaidAging: string;
    };
    aging: {
      current: string;
      days1to30: string;
      days31to60: string;
      days60plus: string;
    };
    noExpenses: string;
  };
  settings: {
    title: string;
    language: {
      title: string;
      description: string;
    };
    currency: {
      title: string;
      enabled: string;
      enabledDesc: string;
      default: string;
      defaultDesc: string;
    };
    data: {
      title: string;
      export: string;
      exportDesc: string;
      exportBtn: string;
      exporting: string;
      exported: string;
      exportFailed: string;
      import: string;
      importDesc: string;
      importBtn: string;
      importing: string;
      imported: string;
      importFailed: string;
      invalidFile: string;
      reset: string;
      resetDesc: string;
      resetBtn: string;
      resetConfirm: string;
    };
    about: {
      title: string;
      name: string;
      description: string;
    };
  };
  drawer: {
    transaction: {
      new: string;
      edit: string;
      typeIncome: string;
      typeIncomeDesc: string;
      typeReceivable: string;
      typeReceivableDesc: string;
      typeExpense: string;
      typeExpenseDesc: string;
      amount: string;
      amountPlaceholder: string;
      currency: string;
      date: string;
      dueDate: string;
      client: string;
      clientPlaceholder: string;
      project: string;
      projectPlaceholder: string;
      category: string;
      categoryPlaceholder: string;
      title: string;
      titlePlaceholder: string;
      notes: string;
      notesPlaceholder: string;
    };
    client: {
      new: string;
      edit: string;
      name: string;
      namePlaceholder: string;
      email: string;
      emailPlaceholder: string;
      phone: string;
      phonePlaceholder: string;
      notes: string;
      notesPlaceholder: string;
    };
    project: {
      new: string;
      edit: string;
      name: string;
      namePlaceholder: string;
      client: string;
      clientPlaceholder: string;
      field: string;
      fieldPlaceholder: string;
      notes: string;
      notesPlaceholder: string;
    };
  };
  filters: {
    thisMonth: string;
    lastMonth: string;
    thisYear: string;
    allTime: string;
    custom: string;
    all: string;
    type: {
      all: string;
      income: string;
      receivable: string;
      expense: string;
    };
    status: {
      all: string;
      paid: string;
      unpaid: string;
      overdue: string;
    };
  };
  validation: {
    required: string;
    amountRequired: string;
    dateRequired: string;
    nameRequired: string;
  };
  time: {
    today: string;
    yesterday: string;
    daysAgo: string;
    weeksAgo: string;
    monthsAgo: string;
    yearsAgo: string;
    daysOverdue: string;
    dueInDays: string;
  };
}
