// Shapes returned by the backend's /api/m1 endpoints.
import type { Role } from './api';

export type Segment = 'home' | 'hospital' | 'lab' | 'office' | 'industry';
export type BookingStatus = 'requested' | 'accepted' | 'on_the_way' | 'in_progress' | 'completed' | 'cancelled';

export interface User {
  id: number;
  phone: string;
  role: Role;
  name: string | null;
  email: string | null;
  segment: Segment | null;
  orgName: string | null;
  address: string | null;
  city: string | null;
  pincode: string | null;
  skills: number[];
  servicePincodes: string[];
  experienceYears: number | null;
  companyName: string | null;
  about: string | null;
  rates: Record<string, number>; // engineer: visit charge per category id
  // Engineer registered in B2G Service Management (login is allowed only then).
  b2gEngineer: { ids: number[]; empIds: string[]; companies: string[]; areas: { state: string; districts: string[] }[]; skillNames?: string[] } | null;
  isAvailable: boolean;
  profileComplete: boolean;
  rating: number | null;
  ratingCount: number;
}

export interface Service { id: number; name: string; description: string | null; price: number; durationMins: number }
export interface Category { id: number; name: string; icon: string; color: string; segments: Segment[]; services: Service[] }

export interface Booking {
  id: number;
  bookingNo: string;
  status: BookingStatus;
  segment: Segment | null;
  service: { id: number; name: string; durationMins: number } | null; // name joins all services, e.g. "AC repair + Gas refill"
  services: { id: number; name: string; price?: number }[];
  category: { id: number; name: string; icon: string; color: string } | null;
  issue: string | null;
  equipment: { brand: string; model: string; serialNo: string } | null;
  address: string;
  city: string;
  pincode: string;
  contactName: string | null;
  contactPhone: string | null;
  scheduledDate: string;
  slot: string;
  visitCharge: number;
  finalAmount: number | null;
  partsUsed: { name: string; qty: number; price: number }[];
  workNotes: string | null;
  rating: number | null;
  review: string | null;
  cancelReason: string | null;
  timeline: { status: BookingStatus; at: string; note?: string }[];
  createdAt: string;
  // Engineer's latest request to move the visit; the customer answers it.
  arrivedAt: string | null; // engineer marked "I've reached the spot"
  workPhotos?: string[]; // after-work photos the engineer took ("/uploads/m1-work/…")
  photos: string[]; // problem photos the customer added ("/uploads/m1-problems/…")
  productId?: number | null; // which of My Products this booking was for
  rescheduleRequest: {
    fromDate: string; fromSlot: string; date: string; slot: string; reason: string;
    status: 'pending' | 'accepted' | 'rejected' | 'expired'; at: string; answeredAt?: string;
  } | null;
  // Customer view
  startOtp?: string | null;
  engineer?: { name: string | null; phone: string; experienceYears: number | null; rating: number | null; ratingCount: number; companyName: string | null } | null;
  requestedEngineer?: { id: number; name: string | null; companyName: string | null } | null; // picked, not yet accepted
  // Engineer view
  customer?: { name: string | null; orgName: string | null; phone: string | null } | null;
  direct?: boolean; // the customer picked this engineer by name
}

// What the B2G portal knows about a mobile number (sign-up prefill).
export interface B2GMatch {
  source: 'client' | 'user';
  id: number;
  label: string;
  name: string;
  orgName: string;
  email: string;
  address: string;
  city: string;
  pincode: string;
  segment: Segment | null;
  industry: string | null;
  products: { name: string; qty: number; lastBought: string; categoryId: number | null }[];
}

// A customer's own equipment ("My Products").
export interface Product {
  id: number;
  name: string;
  categoryId: number | null;
  customCategoryId: number | null;
  categoryKey: string | null; // "b3" basic / "c7" custom / null
  category: { id: number; name: string; icon: string; color: string } | null;
  brand: string | null;
  model: string | null;
  serialNo: string | null;
  purchaseDate: string | null;
  warrantyUntil: string | null;
  location: string | null;
  notes: string | null;
  imageUrl?: string | null; // product photo ("/uploads/m1-products/…")
  createdAt: string;
}

// A My Products category: basic ("b3") or the customer's own ("c7").
export interface ProductCategory {
  key: string;
  name: string;
  icon: string;
  color: string;
  custom: boolean;
  products: number;
}

// The product's OEM company and its service engineers (from B2G Service
// Management) who cover the customer's area.
export interface OemEngineer {
  id: number;            // service_engineers id
  name: string;
  companyName: string;
  match: 'district' | 'state';
  coverage: string;      // the district (or state) that matched
  districts: number;
  onApp: boolean;        // uses the Partner app (same mobile)
  online: boolean;
  rating: number | null;
  ratingCount: number;
  jobsDone: number;
  experienceYears: number | null;
}

// An engineer as a customer sees them when choosing who to book.
export interface EngineerCard {
  id: number;
  name: string | null;
  companyName: string | null;
  experienceYears: number | null;
  city: string | null;
  online: boolean;
  rating: number | null;
  ratingCount: number;
  jobsDone: number;
  rate: number | null; // their charge for the category (or lowest, if rateIsFrom)
  rateIsFrom: boolean;
  skills: { id: number; name: string; icon: string; color: string; rate: number; own: boolean }[]; // own=false: rate is a "from" price
}
export interface EngineerProfile extends EngineerCard {
  about: string | null;
  memberSince: string;
  reviews: { rating: number; review: string | null; service: string | null; date: string }[]; // no customer names
  ratingBreakdown: { stars: number; count: number }[];
  works: { id: number; service: string | null; category: { name: string; icon: string; color: string } | null; brand: string | null; date: string; rating: number | null }[];
}
