export interface HealthiansConstituent {
    id: string;
    name: string;
}

export interface HealthiansProductData {
    id: string;
    name: string;
    fasting: string;
    fasting_time: string;
    reporting_time: string;
    gender: string;
    age_group: string;
    description: string;
    constituents: HealthiansConstituent[];
    status: string;
    source_type: string;
}

export interface HealthiansProductResponse {
    status: boolean;
    message: string;
    data: HealthiansProductData;
    code: number;
}

export interface ConstituentViewModel {
    id: string;
    name: string;
}

export interface ProductDetailsViewModel {
    id: string;
    name: string;
    fasting: string | null;
    fastingTime: string | null;
    reportingTime: string | null;
    gender: string[];
    ageGroup: string[];
    description: string | null;
    constituents: ConstituentViewModel[];
    status: string;
    sourceType: string | null;
    dealType: 'PACKAGE' | 'PROFILE' | 'PARAMETER';
}
