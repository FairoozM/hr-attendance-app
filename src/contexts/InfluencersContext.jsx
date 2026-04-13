import { createContext, useContext, useState, useCallback, useEffect } from 'react'

const STORAGE_KEY = 'hr-influencers-v1'

function loadStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch (_) {}
  return null
}

export const WORKFLOW_STAGES = [
  'New Lead', 'Contacted', 'Waiting for Price', 'Waiting for Insights',
  'Under Review', 'Shortlisted', 'Approved', 'Rejected',
  'Shoot Scheduled', 'Shot Completed', 'Waiting for Upload',
  'Uploaded', 'Payment Pending', 'Paid', 'Closed',
]

export const APPROVAL_STATUSES = ['Pending', 'Shortlisted', 'Approved', 'Rejected']
export const PAYMENT_STATUSES = [
  'Not Requested', 'Bank Details Pending', 'Ready for Payment', 'Payment Processing', 'Paid',
]
export const COLLABORATION_TYPES = [
  'Collaboration Post', 'Reel on Influencer Page', 'Story Only',
  'Reel + Story Package', 'Usage Rights Included', 'Custom',
]
export const CONTACT_STATUSES = [
  'Not Contacted', 'First Contact Made', 'In Discussion', 'Negotiating', 'Offer Shared', 'Deal Closed',
]
export const SHOOT_STATUSES = ['Scheduled', 'Confirmed', 'Completed', 'Cancelled', 'Reschedule Needed']
export const AGREEMENT_STATUSES = ['Not Generated', 'Generated', 'Sent', 'Signed', 'Expired']
export const CURRENCIES = ['AED', 'USD', 'SAR', 'GBP', 'EUR']

const INITIAL_INFLUENCERS = [
  {
    id: '1', name: 'Sara Al Mansouri', mobile: '+971501234567', whatsapp: '+971501234567',
    email: 'sara.almansouri@example.com', nationality: 'Emirati', basedIn: 'Dubai', niche: 'Lifestyle & Fashion',
    instagram: { handle: '@sara_lifestyle', url: 'https://instagram.com/sara_lifestyle' },
    youtube: { handle: 'Sara TV', url: 'https://youtube.com/@saratv' },
    tiktok: { handle: '@sara_uae', url: '' }, snapchat: 'sara_snap', facebook: 'Sara Al Mansouri Official',
    twitter: '@sara_uae', telegram: '@sara_channel', website: 'https://sara.ae', otherSocial: '',
    followersCount: '125,000', engagementRate: '4.2%', avgReelViews: '80,000', avgStoryReach: '15,000',
    audienceNotes: 'Mainly UAE-based, 65% female', insightsReceived: true,
    reelsPrice: 3500, storiesPrice: 1200, packagePrice: 4500, currency: 'AED',
    deliverables: '1 Reel + 3 Stories', collaborationType: 'Reel + Story Package',
    reelStaysOnPage: true, contentForBrand: true,
    contactStatus: 'Deal Closed', discussionNotes: 'Very responsive, interested in collaboration',
    negotiationNotes: 'Asked for 4000 AED, negotiated to 3500', offerShared: true,
    approvalNotes: 'Strong engagement, fits brand perfectly', rejectionNotes: '', followUpReminder: '',
    bankName: 'Emirates NBD', accountTitle: 'Sara Al Mansouri', iban: 'AE070331234567890123456',
    paymentMethod: 'Bank Transfer', paymentNotes: '',
    workflowStatus: 'Approved', approvalStatus: 'Approved', paymentStatus: 'Ready for Payment',
    assignedTo: 'Fatima', shootDate: '2026-04-20', shootTime: '10:00',
    shootLocation: 'Dubai Mall Store', campaign: 'Summer Collection 2026',
    agreementStatus: 'Generated', agreementGenerated: true, signedByInfluencer: false, signedByCompany: false,
    createdAt: '2026-03-15T09:00:00Z', updatedAt: '2026-04-10T14:30:00Z',
    timeline: [
      { event: 'Created', date: '2026-03-15', note: 'Added to system' },
      { event: 'Contacted', date: '2026-03-16', note: 'DM sent on Instagram' },
      { event: 'Price Received', date: '2026-03-18', note: 'Quoted 4000 AED for reel' },
      { event: 'Insights Received', date: '2026-03-20', note: 'Screenshots uploaded' },
      { event: 'Approved', date: '2026-03-25', note: 'Approved by management' },
      { event: 'Agreement Generated', date: '2026-04-10', note: '' },
    ],
  },
  {
    id: '2', name: 'Khalid Al Rashidi', mobile: '+971507654321', whatsapp: '+971507654321',
    email: 'khalid@example.com', nationality: 'Saudi', basedIn: 'Abu Dhabi', niche: 'Food & Travel',
    instagram: { handle: '@khalid_eats', url: 'https://instagram.com/khalid_eats' },
    youtube: { handle: 'Khalid Travels', url: '' }, tiktok: { handle: '', url: '' },
    snapchat: 'khalid_travels', facebook: '', twitter: '', telegram: '', website: '', otherSocial: '',
    followersCount: '89,000', engagementRate: '5.8%', avgReelViews: '55,000', avgStoryReach: '10,000',
    audienceNotes: 'Food lovers, mixed nationalities', insightsReceived: false,
    reelsPrice: 2800, storiesPrice: 900, packagePrice: 3500, currency: 'AED',
    deliverables: '1 Reel + 2 Stories', collaborationType: 'Reel on Influencer Page',
    reelStaysOnPage: true, contentForBrand: false,
    contactStatus: 'Negotiating', discussionNotes: 'Interested but asking for higher price',
    negotiationNotes: 'Currently at 2800, down from 3500', offerShared: true,
    approvalNotes: '', rejectionNotes: '', followUpReminder: '2026-04-15',
    bankName: '', accountTitle: '', iban: '', paymentMethod: 'Bank Transfer', paymentNotes: '',
    workflowStatus: 'Waiting for Insights', approvalStatus: 'Pending', paymentStatus: 'Not Requested',
    assignedTo: 'Ahmed', shootDate: '', shootTime: '', shootLocation: '', campaign: '',
    agreementStatus: 'Not Generated', agreementGenerated: false, signedByInfluencer: false, signedByCompany: false,
    createdAt: '2026-03-20T11:00:00Z', updatedAt: '2026-04-05T09:15:00Z',
    timeline: [
      { event: 'Created', date: '2026-03-20', note: '' },
      { event: 'Contacted', date: '2026-03-22', note: 'WhatsApp message sent' },
      { event: 'Price Received', date: '2026-03-28', note: 'Quoted 3500 AED' },
    ],
  },
  {
    id: '3', name: 'Noor Hassan', mobile: '+971509876543', whatsapp: '+971509876543',
    email: 'noor.hassan@example.com', nationality: 'Lebanese', basedIn: 'Dubai', niche: 'Beauty & Skincare',
    instagram: { handle: '@noor_beauty', url: 'https://instagram.com/noor_beauty' },
    youtube: { handle: '', url: '' }, tiktok: { handle: '@noor_glow', url: 'https://tiktok.com/@noor_glow' },
    snapchat: '', facebook: '', twitter: '@noor_beauty', telegram: '', website: '', otherSocial: '',
    followersCount: '210,000', engagementRate: '3.9%', avgReelViews: '120,000', avgStoryReach: '25,000',
    audienceNotes: '80% female, beauty enthusiasts', insightsReceived: true,
    reelsPrice: 5500, storiesPrice: 1800, packagePrice: 7000, currency: 'AED',
    deliverables: '2 Reels + 4 Stories', collaborationType: 'Reel + Story Package',
    reelStaysOnPage: true, contentForBrand: true,
    contactStatus: 'Deal Closed', discussionNotes: '', negotiationNotes: 'Quick negotiation, accepted package', offerShared: true,
    approvalNotes: 'Top pick for beauty campaign', rejectionNotes: '', followUpReminder: '',
    bankName: 'Mashreq Bank', accountTitle: 'Noor Hassan', iban: 'AE040300000012345678901',
    paymentMethod: 'Bank Transfer', paymentNotes: '',
    workflowStatus: 'Shoot Scheduled', approvalStatus: 'Approved', paymentStatus: 'Ready for Payment',
    assignedTo: 'Fatima', shootDate: '2026-04-18', shootTime: '14:00',
    shootLocation: 'Studio - Business Bay', campaign: 'Glow Series',
    agreementStatus: 'Signed', agreementGenerated: true, signedByInfluencer: true, signedByCompany: true,
    createdAt: '2026-03-10T08:00:00Z', updatedAt: '2026-04-08T16:00:00Z',
    timeline: [
      { event: 'Created', date: '2026-03-10', note: '' },
      { event: 'Contacted', date: '2026-03-11', note: 'DM on Instagram' },
      { event: 'Price Received', date: '2026-03-12', note: 'Agreed 7000 AED package' },
      { event: 'Insights Received', date: '2026-03-14', note: '' },
      { event: 'Approved', date: '2026-03-18', note: '' },
      { event: 'Shoot Scheduled', date: '2026-04-08', note: 'Business Bay Studio' },
      { event: 'Agreement Signed', date: '2026-04-09', note: '' },
    ],
  },
  {
    id: '4', name: 'Omar Al Farsi', mobile: '+971502345678', whatsapp: '+971502345678',
    email: 'omar.alfarsi@example.com', nationality: 'Emirati', basedIn: 'Sharjah', niche: 'Fitness & Health',
    instagram: { handle: '@omar_fit', url: 'https://instagram.com/omar_fit' },
    youtube: { handle: 'Omar Fitness', url: '' }, tiktok: { handle: '', url: '' },
    snapchat: 'omar_fit', facebook: '', twitter: '', telegram: '', website: '', otherSocial: '',
    followersCount: '67,000', engagementRate: '6.1%', avgReelViews: '45,000', avgStoryReach: '8,000',
    audienceNotes: 'Fitness crowd, 70% male', insightsReceived: false,
    reelsPrice: 2000, storiesPrice: 700, packagePrice: 2500, currency: 'AED',
    deliverables: '1 Reel + 2 Stories', collaborationType: 'Collaboration Post',
    reelStaysOnPage: false, contentForBrand: false,
    contactStatus: 'First Contact Made', discussionNotes: 'Sent initial DM, awaiting response',
    negotiationNotes: '', offerShared: false, approvalNotes: '',
    rejectionNotes: 'Not a fit for current beauty campaign', followUpReminder: '2026-04-16',
    bankName: '', accountTitle: '', iban: '', paymentMethod: '', paymentNotes: '',
    workflowStatus: 'Rejected', approvalStatus: 'Rejected', paymentStatus: 'Not Requested',
    assignedTo: 'Ahmed', shootDate: '', shootTime: '', shootLocation: '', campaign: '',
    agreementStatus: 'Not Generated', agreementGenerated: false, signedByInfluencer: false, signedByCompany: false,
    createdAt: '2026-03-25T10:00:00Z', updatedAt: '2026-04-01T11:00:00Z',
    timeline: [
      { event: 'Created', date: '2026-03-25', note: '' },
      { event: 'Contacted', date: '2026-03-26', note: 'DM sent' },
      { event: 'Rejected', date: '2026-04-01', note: 'Not suitable for beauty campaign' },
    ],
  },
  {
    id: '5', name: 'Layla Mohammed', mobile: '+971503456789', whatsapp: '+971503456789',
    email: 'layla.m@example.com', nationality: 'Egyptian', basedIn: 'Dubai', niche: 'Parenting & Family',
    instagram: { handle: '@layla_family', url: 'https://instagram.com/layla_family' },
    youtube: { handle: 'Layla Family', url: '' }, tiktok: { handle: '', url: '' },
    snapchat: '', facebook: 'Layla Family Page', twitter: '', telegram: '', website: '', otherSocial: '',
    followersCount: '43,000', engagementRate: '7.3%', avgReelViews: '30,000', avgStoryReach: '6,000',
    audienceNotes: 'Moms, family-oriented audience', insightsReceived: true,
    reelsPrice: 1500, storiesPrice: 600, packagePrice: 2000, currency: 'AED',
    deliverables: '1 Reel + 3 Stories', collaborationType: 'Reel + Story Package',
    reelStaysOnPage: true, contentForBrand: true,
    contactStatus: 'Deal Closed', discussionNotes: '', negotiationNotes: 'Accepted first price', offerShared: true,
    approvalNotes: 'Good fit for family-friendly campaigns', rejectionNotes: '', followUpReminder: '',
    bankName: 'FAB', accountTitle: 'Layla Mohammed', iban: 'AE280351234567890123456',
    paymentMethod: 'Bank Transfer', paymentNotes: '',
    workflowStatus: 'Waiting for Upload', approvalStatus: 'Approved', paymentStatus: 'Ready for Payment',
    assignedTo: 'Fatima', shootDate: '2026-04-10', shootTime: '11:00',
    shootLocation: 'Home Studio - JVC', campaign: 'Family Special',
    agreementStatus: 'Signed', agreementGenerated: true, signedByInfluencer: true, signedByCompany: true,
    createdAt: '2026-03-28T09:00:00Z', updatedAt: '2026-04-12T10:00:00Z',
    timeline: [
      { event: 'Created', date: '2026-03-28', note: '' },
      { event: 'Contacted', date: '2026-03-29', note: '' },
      { event: 'Price Received', date: '2026-03-30', note: 'Package 2000 AED' },
      { event: 'Insights Received', date: '2026-04-01', note: '' },
      { event: 'Approved', date: '2026-04-02', note: '' },
      { event: 'Shoot Scheduled', date: '2026-04-05', note: '' },
      { event: 'Shot Completed', date: '2026-04-10', note: '' },
      { event: 'Waiting for Upload', date: '2026-04-12', note: 'Editing in progress' },
    ],
  },
  {
    id: '6', name: 'Rania Khoury', mobile: '+971504567890', whatsapp: '+971504567890',
    email: 'rania.k@example.com', nationality: 'Syrian', basedIn: 'Abu Dhabi', niche: 'Food & Cooking',
    instagram: { handle: '@rania_cooks', url: '' }, youtube: { handle: '', url: '' },
    tiktok: { handle: '', url: '' }, snapchat: '', facebook: '', twitter: '', telegram: '', website: '', otherSocial: '',
    followersCount: '28,000', engagementRate: '8.9%', avgReelViews: '18,000', avgStoryReach: '4,000',
    audienceNotes: 'Home cooks, recipe followers', insightsReceived: false,
    reelsPrice: 1200, storiesPrice: 400, packagePrice: 1500, currency: 'AED',
    deliverables: '1 Reel + 2 Stories', collaborationType: 'Reel on Influencer Page',
    reelStaysOnPage: true, contentForBrand: false,
    contactStatus: 'In Discussion', discussionNotes: 'Interested, needs more details about product',
    negotiationNotes: '', offerShared: false, approvalNotes: '', rejectionNotes: '', followUpReminder: '2026-04-17',
    bankName: '', accountTitle: '', iban: '', paymentMethod: '', paymentNotes: '',
    workflowStatus: 'Contacted', approvalStatus: 'Pending', paymentStatus: 'Not Requested',
    assignedTo: 'Ahmed', shootDate: '', shootTime: '', shootLocation: '', campaign: '',
    agreementStatus: 'Not Generated', agreementGenerated: false, signedByInfluencer: false, signedByCompany: false,
    createdAt: '2026-04-05T10:00:00Z', updatedAt: '2026-04-11T12:00:00Z',
    timeline: [
      { event: 'Created', date: '2026-04-05', note: '' },
      { event: 'Contacted', date: '2026-04-06', note: 'WhatsApp message' },
    ],
  },
  {
    id: '7', name: 'Tariq Bin Saleh', mobile: '+971505678901', whatsapp: '+971505678901',
    email: 'tariq@example.com', nationality: 'Pakistani', basedIn: 'Dubai', niche: 'Tech & Gadgets',
    instagram: { handle: '@tariq_tech', url: '' },
    youtube: { handle: 'Tariq Tech Reviews', url: 'https://youtube.com/@tariqtech' },
    tiktok: { handle: '', url: '' }, snapchat: '', facebook: '', twitter: '@tariqtech_uae',
    telegram: '', website: '', otherSocial: 'LinkedIn: Tariq Bin Saleh',
    followersCount: '35,000', engagementRate: '5.2%', avgReelViews: '22,000', avgStoryReach: '5,500',
    audienceNotes: 'Tech-savvy, mostly male', insightsReceived: true,
    reelsPrice: 1800, storiesPrice: 600, packagePrice: 2300, currency: 'AED',
    deliverables: '1 Reel + 2 Stories', collaborationType: 'Collaboration Post',
    reelStaysOnPage: true, contentForBrand: false,
    contactStatus: 'Not Contacted', discussionNotes: '', negotiationNotes: '', offerShared: false,
    approvalNotes: '', rejectionNotes: '', followUpReminder: '',
    bankName: '', accountTitle: '', iban: '', paymentMethod: '', paymentNotes: '',
    workflowStatus: 'New Lead', approvalStatus: 'Pending', paymentStatus: 'Not Requested',
    assignedTo: 'Ahmed', shootDate: '', shootTime: '', shootLocation: '', campaign: '',
    agreementStatus: 'Not Generated', agreementGenerated: false, signedByInfluencer: false, signedByCompany: false,
    createdAt: '2026-04-08T09:00:00Z', updatedAt: '2026-04-08T09:00:00Z',
    timeline: [{ event: 'Created', date: '2026-04-08', note: '' }],
  },
  {
    id: '8', name: 'Mia Torres', mobile: '+971506789012', whatsapp: '+971506789012',
    email: 'mia.torres@example.com', nationality: 'Filipino', basedIn: 'Dubai', niche: 'Fashion & Style',
    instagram: { handle: '@mia_style_uae', url: 'https://instagram.com/mia_style_uae' },
    youtube: { handle: '', url: '' }, tiktok: { handle: '@mia_fashion', url: '' },
    snapchat: '', facebook: '', twitter: '', telegram: '', website: '', otherSocial: '',
    followersCount: '78,000', engagementRate: '4.7%', avgReelViews: '50,000', avgStoryReach: '12,000',
    audienceNotes: 'Young women, fashion-forward', insightsReceived: true,
    reelsPrice: 2500, storiesPrice: 850, packagePrice: 3200, currency: 'AED',
    deliverables: '1 Reel + 3 Stories', collaborationType: 'Reel + Story Package',
    reelStaysOnPage: true, contentForBrand: true,
    contactStatus: 'Deal Closed', discussionNotes: '', negotiationNotes: 'Negotiated down from 4000 to 3200', offerShared: true,
    approvalNotes: 'Great fit for fashion campaigns', rejectionNotes: '', followUpReminder: '',
    bankName: 'RAK Bank', accountTitle: 'Mia Torres', iban: 'AE200400000098765432101',
    paymentMethod: 'Bank Transfer', paymentNotes: '',
    workflowStatus: 'Payment Pending', approvalStatus: 'Approved', paymentStatus: 'Ready for Payment',
    assignedTo: 'Fatima', shootDate: '2026-04-05', shootTime: '15:00',
    shootLocation: 'Downtown Dubai', campaign: 'Spring Fashion',
    agreementStatus: 'Signed', agreementGenerated: true, signedByInfluencer: true, signedByCompany: true,
    createdAt: '2026-03-18T10:00:00Z', updatedAt: '2026-04-11T17:00:00Z',
    timeline: [
      { event: 'Created', date: '2026-03-18', note: '' },
      { event: 'Contacted', date: '2026-03-19', note: '' },
      { event: 'Price Received', date: '2026-03-21', note: '' },
      { event: 'Insights Received', date: '2026-03-23', note: '' },
      { event: 'Approved', date: '2026-03-26', note: '' },
      { event: 'Shoot Scheduled', date: '2026-04-01', note: '' },
      { event: 'Shot Completed', date: '2026-04-05', note: '' },
      { event: 'Uploaded', date: '2026-04-08', note: 'Posted on Instagram' },
      { event: 'Payment Pending', date: '2026-04-11', note: 'Awaiting finance approval' },
    ],
  },
  {
    id: '9', name: 'Yousef Al Ameri', mobile: '+971507890123', whatsapp: '+971507890123',
    email: 'yousef@example.com', nationality: 'Emirati', basedIn: 'Al Ain', niche: 'Sports & Outdoors',
    instagram: { handle: '@yousef_sports', url: '' }, youtube: { handle: '', url: '' },
    tiktok: { handle: '', url: '' }, snapchat: 'yousef_sports', facebook: '', twitter: '', telegram: '', website: '', otherSocial: '',
    followersCount: '22,000', engagementRate: '9.1%', avgReelViews: '15,000', avgStoryReach: '3,500',
    audienceNotes: 'Sports fans, outdoor enthusiasts', insightsReceived: false,
    reelsPrice: 1000, storiesPrice: 350, packagePrice: 1300, currency: 'AED',
    deliverables: '1 Reel + 2 Stories', collaborationType: 'Collaboration Post',
    reelStaysOnPage: true, contentForBrand: false,
    contactStatus: 'First Contact Made', discussionNotes: '', negotiationNotes: '', offerShared: false,
    approvalNotes: '', rejectionNotes: '', followUpReminder: '2026-04-18',
    bankName: '', accountTitle: '', iban: '', paymentMethod: '', paymentNotes: '',
    workflowStatus: 'Contacted', approvalStatus: 'Pending', paymentStatus: 'Not Requested',
    assignedTo: 'Ahmed', shootDate: '', shootTime: '', shootLocation: '', campaign: '',
    agreementStatus: 'Not Generated', agreementGenerated: false, signedByInfluencer: false, signedByCompany: false,
    createdAt: '2026-04-09T11:00:00Z', updatedAt: '2026-04-09T11:00:00Z',
    timeline: [
      { event: 'Created', date: '2026-04-09', note: '' },
      { event: 'Contacted', date: '2026-04-09', note: 'Snapchat message' },
    ],
  },
  {
    id: '10', name: 'Aisha Farooq', mobile: '+971508901234', whatsapp: '+971508901234',
    email: 'aisha.f@example.com', nationality: 'Pakistani', basedIn: 'Sharjah', niche: 'Modest Fashion',
    instagram: { handle: '@aisha_modest', url: 'https://instagram.com/aisha_modest' },
    youtube: { handle: '', url: '' }, tiktok: { handle: '@aisha_fashion', url: '' },
    snapchat: '', facebook: 'Aisha Modest Fashion', twitter: '', telegram: '@aisha_modest', website: '', otherSocial: '',
    followersCount: '55,000', engagementRate: '6.8%', avgReelViews: '40,000', avgStoryReach: '9,000',
    audienceNotes: 'Modest fashion, predominantly Muslim women', insightsReceived: true,
    reelsPrice: 2200, storiesPrice: 750, packagePrice: 2800, currency: 'AED',
    deliverables: '1 Reel + 3 Stories', collaborationType: 'Reel + Story Package',
    reelStaysOnPage: true, contentForBrand: true,
    contactStatus: 'Deal Closed', discussionNotes: 'Highly professional, quick responses',
    negotiationNotes: 'Accepted package price without negotiation', offerShared: true,
    approvalNotes: 'Perfect for modest fashion campaigns', rejectionNotes: '', followUpReminder: '',
    bankName: 'Dubai Islamic Bank', accountTitle: 'Aisha Farooq', iban: 'AE650400000876543210001',
    paymentMethod: 'Bank Transfer', paymentNotes: '',
    workflowStatus: 'Paid', approvalStatus: 'Approved', paymentStatus: 'Paid',
    assignedTo: 'Fatima', shootDate: '2026-03-28', shootTime: '13:00',
    shootLocation: 'Sharjah City Centre', campaign: 'Ramadan Collection',
    agreementStatus: 'Signed', agreementGenerated: true, signedByInfluencer: true, signedByCompany: true,
    createdAt: '2026-03-01T08:00:00Z', updatedAt: '2026-04-05T14:00:00Z',
    timeline: [
      { event: 'Created', date: '2026-03-01', note: '' },
      { event: 'Contacted', date: '2026-03-02', note: '' },
      { event: 'Price Received', date: '2026-03-03', note: '' },
      { event: 'Insights Received', date: '2026-03-05', note: '' },
      { event: 'Approved', date: '2026-03-08', note: '' },
      { event: 'Shoot Scheduled', date: '2026-03-20', note: '' },
      { event: 'Shot Completed', date: '2026-03-28', note: '' },
      { event: 'Uploaded', date: '2026-04-01', note: 'Posted successfully' },
      { event: 'Payment Completed', date: '2026-04-05', note: 'Bank transfer confirmed' },
    ],
  },
]

const InfluencersContext = createContext(null)

export function InfluencersProvider({ children }) {
  const [influencers, setInfluencers] = useState(() => loadStored() ?? INITIAL_INFLUENCERS)

  // Persist every change to localStorage so deletes/adds/edits survive page refresh
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(influencers)) } catch (_) {}
  }, [influencers])

  const addInfluencer = useCallback((data) => {
    const newInfluencer = {
      ...data,
      id: Date.now().toString(),
      workflowStatus: data.workflowStatus || 'New Lead',
      approvalStatus: data.approvalStatus || 'Pending',
      paymentStatus: data.paymentStatus || 'Not Requested',
      agreementGenerated: false, signedByInfluencer: false, signedByCompany: false,
      timeline: [{ event: 'Created', date: new Date().toISOString().split('T')[0], note: 'Added to system' }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    setInfluencers(prev => [newInfluencer, ...prev])
    return newInfluencer.id
  }, [])

  const updateInfluencer = useCallback((id, updates) => {
    setInfluencers(prev =>
      prev.map(inf => inf.id === id ? { ...inf, ...updates, updatedAt: new Date().toISOString() } : inf)
    )
  }, [])

  const updateWorkflowStatus = useCallback((id, status, note = '') => {
    setInfluencers(prev =>
      prev.map(inf => {
        if (inf.id !== id) return inf
        const entry = { event: status, date: new Date().toISOString().split('T')[0], note }
        return { ...inf, workflowStatus: status, updatedAt: new Date().toISOString(), timeline: [...(inf.timeline || []), entry] }
      })
    )
  }, [])

  const deleteInfluencer = useCallback((id) => {
    setInfluencers(prev => prev.filter(inf => inf.id !== id))
  }, [])

  return (
    <InfluencersContext.Provider value={{ influencers, addInfluencer, updateInfluencer, updateWorkflowStatus, deleteInfluencer }}>
      {children}
    </InfluencersContext.Provider>
  )
}

export function useInfluencers() {
  const ctx = useContext(InfluencersContext)
  if (!ctx) throw new Error('useInfluencers must be used within InfluencersProvider')
  return ctx
}
