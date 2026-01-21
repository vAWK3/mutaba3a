import{j as e,r as I,a as ye,g as $e,f as Ye}from"./vendor-router-D4Yqsbqz.js";import{X as z,u as be,a as ze,O as ue,N as he,T as Fe,c as C,S as Xe,n as Me,I as Oe,aK as Je,P as Ze,x as et,W as G,V as tt}from"./index-D5Ndap8n.js";/* empty css              */import{E as it}from"./EmptyState-r3axvhwz.js";/* empty css                       */import{b as le,u as se,a as ae}from"./vendor-query-CI0tl4qS.js";import{S as je,D as nt,P as st,V as f,I as at,T as x,p as rt}from"./fonts-B2QO5WSf.js";import{h as Y,C as F,f as ne,u as ot,F as lt,o as de,c as T,_ as te,d as X,n as _,e as J}from"./vendor-forms-Bf8hyTk9.js";import"./vendor-react-BdxwsYZ-.js";import"./vendor-db-BMy7eggi.js";import"./_commonjs-dynamic-modules-TDtrdbi3.js";function De(){return crypto.randomUUID()}function ie(){return new Date().toISOString()}const W={async list(t={}){const n=await z.engagements.toArray(),i=await z.engagementVersions.toArray(),s=await z.clients.toArray(),c=await z.projects.toArray(),l=await z.businessProfiles.toArray(),r=new Map(s.map(v=>[v.id,v.name])),d=new Map(c.map(v=>[v.id,v.name])),u=new Map(l.map(v=>[v.id,v.name])),p=new Map;i.forEach(v=>{const b=p.get(v.engagementId)||[];b.push(v),p.set(v.engagementId,b)});let a=n.filter(v=>{if(!t.includeArchived&&v.archivedAt||t.profileId&&v.profileId!==t.profileId||t.clientId&&v.clientId!==t.clientId||t.projectId&&v.projectId!==t.projectId||t.type&&v.type!==t.type||t.status&&v.status!==t.status||t.category&&v.category!==t.category)return!1;if(t.search){const b=t.search.toLowerCase(),k=r.get(v.clientId)||"",L=(p.get(v.id)||[]).sort((m,w)=>w.versionNumber-m.versionNumber)[0]?.snapshot?.title||"";if(!(k.toLowerCase().includes(b)||L.toLowerCase().includes(b)))return!1}return!0});const N=t.sort?.by||"createdAt",S=t.sort?.dir||"desc";return a.sort((v,b)=>{const k=v[N],E=b[N],A=k.localeCompare(E);return S==="desc"?-A:A}),t.offset&&(a=a.slice(t.offset)),t.limit&&(a=a.slice(0,t.limit)),a.map(v=>{const b=p.get(v.id)||[],k=b.sort((E,A)=>A.versionNumber-E.versionNumber)[0];return{...v,profileName:u.get(v.profileId),clientName:r.get(v.clientId),projectName:v.projectId?d.get(v.projectId):void 0,title:k?.snapshot?.title,versionCount:b.length,lastVersionAt:k?.createdAt}})},async get(t){return z.engagements.get(t)},async getDisplay(t){const n=await this.get(t);if(!n)return;const i=await z.businessProfiles.get(n.profileId),s=await z.clients.get(n.clientId),c=n.projectId?await z.projects.get(n.projectId):void 0,l=await this.getVersions(t),r=l.sort((d,u)=>u.versionNumber-d.versionNumber)[0];return{...n,profileName:i?.name,clientName:s?.name,projectName:c?.name,title:r?.snapshot?.title,versionCount:l.length,lastVersionAt:r?.createdAt}},async create(t){const n=ie(),i={...t,id:De(),createdAt:n,updatedAt:n};return await z.engagements.add(i),i},async update(t,n){await z.engagements.update(t,{...n,updatedAt:ie()})},async archive(t){await z.engagements.update(t,{archivedAt:ie(),updatedAt:ie(),status:"archived"})},async restore(t){await z.engagements.update(t,{archivedAt:void 0,updatedAt:ie(),status:"draft"})},async delete(t){const n=await this.getVersions(t);for(const i of n)await z.engagementVersions.delete(i.id);await z.engagements.delete(t)},async getVersions(t){return z.engagementVersions.where("engagementId").equals(t).toArray()},async getVersion(t){return z.engagementVersions.get(t)},async getLatestVersion(t){const n=await this.getVersions(t);if(n.length!==0)return n.sort((i,s)=>s.versionNumber-i.versionNumber)[0]},async saveVersion(t,n,i="draft"){const s=ie(),c=await this.getVersions(t),l=c.length>0?Math.max(...c.map(d=>d.versionNumber)):0,r={id:De(),engagementId:t,versionNumber:l+1,status:i,snapshot:n,createdAt:s};return await z.engagementVersions.add(r),await this.update(t,{currentVersionId:r.id}),r},async finalize(t,n){const i=await this.saveVersion(t,n,"final");return await this.update(t,{status:"final",currentVersionId:i.id}),i},async duplicate(t,n,i){const s=await this.get(t);if(!s)throw new Error("Engagement not found");const c=await this.getLatestVersion(t);if(!c)throw new Error("No version found");const l=i||s.profileId,r=await z.businessProfiles.get(l),d=await this.create({profileId:l,clientId:n||s.clientId,projectId:void 0,type:s.type,category:s.category,primaryLanguage:s.primaryLanguage,status:"draft"}),u={...c.snapshot,profileId:l,profileName:r?.name||"",clientId:n||s.clientId,projectId:void 0,projectName:void 0};return await this.saveVersion(d.id,u,"draft"),d},async getByProfile(t){return this.list({profileId:t})},async getByClient(t){return this.list({clientId:t})},async getByProject(t){return this.list({projectId:t})},async countByStatus(){const t=await z.engagements.toArray(),n={draft:0,final:0,archived:0};for(const i of t)n[i.status]++;return n}},ce={engagements:t=>["engagements",t],engagement:t=>["engagement",t],engagementDisplay:t=>["engagementDisplay",t],engagementVersions:t=>["engagementVersions",t],engagementVersion:t=>["engagementVersion",t],latestVersion:t=>["latestVersion",t],countByStatus:()=>["engagementCountByStatus"],byProfile:t=>["engagementsByProfile",t],byClient:t=>["engagementsByClient",t],byProject:t=>["engagementsByProject",t]};function ge(t){t.invalidateQueries({queryKey:["engagements"]}),t.invalidateQueries({queryKey:["engagement"]}),t.invalidateQueries({queryKey:["engagementDisplay"]}),t.invalidateQueries({queryKey:["engagementCountByStatus"]}),t.invalidateQueries({queryKey:["engagementsByProfile"]}),t.invalidateQueries({queryKey:["engagementsByClient"]}),t.invalidateQueries({queryKey:["engagementsByProject"]})}function ct(t){t.invalidateQueries({queryKey:["engagementVersions"]}),t.invalidateQueries({queryKey:["engagementVersion"]}),t.invalidateQueries({queryKey:["latestVersion"]})}function we(t){ge(t),ct(t)}function dt(t={}){return le({queryKey:ce.engagements(t),queryFn:()=>W.list(t)})}function mt(t){return le({queryKey:ce.engagement(t),queryFn:()=>W.get(t),enabled:!!t})}function pt(t){return le({queryKey:ce.engagementDisplay(t),queryFn:()=>W.getDisplay(t),enabled:!!t})}function ut(){return le({queryKey:ce.countByStatus(),queryFn:()=>W.countByStatus()})}function Be(t){return le({queryKey:ce.latestVersion(t),queryFn:()=>W.getLatestVersion(t),enabled:!!t})}function ht(){const t=se();return ae({mutationFn:n=>W.create(n),onSuccess:()=>ge(t)})}function gt(){const t=se();return ae({mutationFn:n=>W.archive(n),onSuccess:()=>ge(t)})}function xt(){const t=se();return ae({mutationFn:n=>W.restore(n),onSuccess:()=>ge(t)})}function vt(){const t=se();return ae({mutationFn:({id:n,newClientId:i})=>W.duplicate(n,i),onSuccess:()=>we(t)})}function ft(){const t=se();return ae({mutationFn:({engagementId:n,snapshot:i,status:s="draft"})=>W.saveVersion(n,i,s),onSuccess:()=>we(t)})}function yt(){const t=se();return ae({mutationFn:({engagementId:n,snapshot:i})=>W.finalize(n,i),onSuccess:()=>we(t)})}const bt={engagementAgreement:"Engagement Agreement",taskEngagement:"Task-Based Engagement",retainerEngagement:"Retainer Engagement",provider:"Provider",client:"Client",summary:"Summary",scope:"Scope of Work",deliverables:"Deliverables",exclusions:"Exclusions",dependencies:"Dependencies",timeline:"Timeline",startDate:"Start Date",endDate:"End Date",milestones:"Milestones",reviewWindow:"Review Window",reviews:"Reviews & Revisions",revisionRounds:"Revision Rounds",revisionDefinition:"Revision Definition",bugFixPeriod:"Bug Fix Period",payment:"Payment Terms",totalAmount:"Total Amount",deposit:"Deposit",paymentSchedule:"Payment Schedule",lateFee:"Late Payment Fee",retainerAmount:"Monthly Retainer",billingDay:"Billing Day",rollover:"Rollover Rule",outOfScopeRate:"Out-of-Scope Rate",relationship:"Relationship Terms",termType:"Term Type",terminationNotice:"Termination Notice",cancellationCoverage:"Cancellation Coverage",ownershipTransfer:"Ownership Transfer",terms:"Standard Terms",confidentiality:"Confidentiality",ipOwnership:"IP Ownership",warranty:"Warranty Disclaimer",liabilityLimit:"Limitation of Liability",nonSolicitation:"Non-Solicitation",disputeResolution:"Dispute Resolution",governingLaw:"Governing Law",signatures:"Signatures",days:"days",rounds:"rounds",percent:"%",enabled:"Enabled",disabled:"Disabled",fixed:"Fixed Term",monthToMonth:"Month-to-Month",negotiation:"Good Faith Negotiation",mediation:"Mediation",arbitration:"Binding Arbitration",noRollover:"No Rollover",carryForward:"Carry Forward",useOrLose:"Use or Lose",onSigning:"On Signing",onMilestone:"On Milestone",onCompletion:"On Completion",monthly:"Monthly",design:"Design",development:"Development",consulting:"Consulting",marketing:"Marketing",legal:"Legal",other:"Other",legalTerms:"Terms and Conditions",generatedBy:"Generated by Mutaba3a",page:"Page",of:"of"},jt={engagementAgreement:"اتفاقية العمل",taskEngagement:"عمل قائم على المهام",retainerEngagement:"عقد شهري",provider:"مقدم الخدمة",client:"العميل",summary:"الملخص",scope:"نطاق العمل",deliverables:"التسليمات",exclusions:"الاستثناءات",dependencies:"المتطلبات المسبقة",timeline:"الجدول الزمني",startDate:"تاريخ البدء",endDate:"تاريخ الانتهاء",milestones:"المراحل",reviewWindow:"فترة المراجعة",reviews:"المراجعات والتعديلات",revisionRounds:"جولات التعديل",revisionDefinition:"تعريف التعديل",bugFixPeriod:"فترة إصلاح الأخطاء",payment:"شروط الدفع",totalAmount:"المبلغ الإجمالي",deposit:"الدفعة المقدمة",paymentSchedule:"جدول الدفع",lateFee:"رسوم التأخير",retainerAmount:"المبلغ الشهري",billingDay:"يوم الفوترة",rollover:"قاعدة الترحيل",outOfScopeRate:"سعر العمل الإضافي",relationship:"شروط العلاقة",termType:"نوع المدة",terminationNotice:"إشعار الإنهاء",cancellationCoverage:"تغطية الإلغاء",ownershipTransfer:"نقل الملكية",terms:"الشروط القياسية",confidentiality:"السرية",ipOwnership:"ملكية الفكرية",warranty:"إخلاء الضمان",liabilityLimit:"تحديد المسؤولية",nonSolicitation:"عدم الاستقطاب",disputeResolution:"حل النزاعات",governingLaw:"القانون الحاكم",signatures:"التوقيعات",days:"أيام",rounds:"جولات",percent:"٪",enabled:"مفعل",disabled:"معطل",fixed:"مدة محددة",monthToMonth:"شهر بشهر",negotiation:"التفاوض بحسن نية",mediation:"الوساطة",arbitration:"التحكيم الملزم",noRollover:"بدون ترحيل",carryForward:"ترحيل للأمام",useOrLose:"استخدم أو افقد",onSigning:"عند التوقيع",onMilestone:"عند المرحلة",onCompletion:"عند الإنجاز",monthly:"شهري",design:"تصميم",development:"تطوير",consulting:"استشارات",marketing:"تسويق",legal:"قانوني",other:"أخرى",legalTerms:"الشروط والأحكام",generatedBy:"تم إنشاؤه بواسطة متابعة",page:"صفحة",of:"من"};function Ne(t){return t==="ar"?jt:bt}function wt(t,n){const i=Ne(n);return t==="task"?i.taskEngagement:i.retainerEngagement}function Nt(t,n){const i=Ne(n);return{design:i.design,development:i.development,consulting:i.consulting,marketing:i.marketing,legal:i.legal,other:i.other}[t]||i.other}const o=je.create({page:{padding:"20mm",fontSize:11,lineHeight:1.5,backgroundColor:"#ffffff"},header:{marginBottom:20},title:{fontSize:22,fontWeight:700,marginBottom:8},subtitle:{fontSize:12,color:"#666666",marginBottom:4},section:{marginBottom:20},sectionTitle:{fontSize:14,fontWeight:600,marginBottom:10,paddingBottom:4,borderBottomWidth:1,borderBottomColor:"#e0e0e0"},sectionContent:{paddingLeft:0},paragraph:{marginBottom:8,fontSize:11,lineHeight:1.6},list:{marginBottom:8},listItem:{flexDirection:"row",marginBottom:4},listBullet:{width:15,fontSize:11},listContent:{flex:1,fontSize:11},table:{marginBottom:12},tableHeader:{flexDirection:"row",backgroundColor:"#f5f5f5",borderBottomWidth:1,borderBottomColor:"#e0e0e0",paddingVertical:6,paddingHorizontal:8},tableRow:{flexDirection:"row",borderBottomWidth:.5,borderBottomColor:"#e0e0e0",paddingVertical:6,paddingHorizontal:8},tableCell:{fontSize:10},tableCellHeader:{fontSize:10,fontWeight:600},infoRow:{flexDirection:"row",marginBottom:4},infoLabel:{width:120,fontSize:10,color:"#666666"},infoValue:{flex:1,fontSize:10,fontWeight:500},partiesSection:{flexDirection:"row",marginBottom:20,gap:20},partyBox:{flex:1,padding:12,backgroundColor:"#f9f9f9",borderRadius:4},partyTitle:{fontSize:10,color:"#666666",marginBottom:4},partyName:{fontSize:12,fontWeight:600,marginBottom:4},badge:{display:"flex",paddingHorizontal:6,paddingVertical:2,backgroundColor:"#e0e0e0",borderRadius:4,fontSize:9,marginRight:4},badgesRow:{flexDirection:"row",flexWrap:"wrap",gap:4,marginBottom:8},footer:{marginTop:"auto",paddingTop:20,borderTopWidth:1,borderTopColor:"#e0e0e0",fontSize:9,color:"#666666"},signatureSection:{flexDirection:"row",marginTop:40,gap:40},signatureBox:{flex:1},signatureLine:{borderBottomWidth:1,borderBottomColor:"#000000",marginBottom:8,height:40},signatureLabel:{fontSize:10,color:"#666666"},amount:{fontSize:14,fontWeight:600},amountMuted:{fontSize:11,color:"#666666"},legalClausesHeader:{marginTop:20,marginBottom:12,paddingBottom:6,borderBottomWidth:2,borderBottomColor:"#333333"},legalClausesTitle:{fontSize:14,fontWeight:700},legalSection:{marginTop:14,marginBottom:10},legalSectionTitle:{fontSize:11,fontWeight:600,marginBottom:8,color:"#111111"},legalSubsection:{marginBottom:10,marginLeft:0},legalSubsectionTitle:{fontSize:10,fontWeight:600,color:"#333333",marginBottom:3},legalSubsectionContent:{fontSize:9,lineHeight:1.5,textAlign:"justify",color:"#333333"}});function St(t){return t==="ar"?"IBMPlexSansArabic":"IBMPlexSans"}function kt(t){return t==="ar"?"right":"left"}const Ct={version:"1.0.0",sections:[{id:"5",title:"Intellectual Property",toggleKey:"ipOwnership",subsections:[{id:"5.1",title:"Work Product",content:'In this Agreement, "Work Product" means all discoveries, designs, developments, improvements, inventions (whether or not patentable), works of authorship, trade secrets, software, source code, documentation, technical data, and any other works, materials, and deliverables that {serviceprovider}, solely or jointly with others, creates, conceives, develops, or reduces to practice in the performance of the Services.'},{id:"5.2",title:"Assignment of Work Product",content:"Upon full payment of all amounts due under this Agreement, {serviceprovider} hereby irrevocably assigns to {company} all right, title, and interest in and to the Work Product, including all intellectual property rights therein. Until such full payment, {serviceprovider} retains ownership of the Work Product, and {company} shall have no rights to use, modify, or distribute the Work Product."},{id:"5.3",title:"Pre-existing Materials",content:'{serviceprovider} retains all right, title, and interest in any materials, tools, libraries, frameworks, or intellectual property owned by or licensed to {serviceprovider} prior to the Effective Date or developed independently outside the scope of this Agreement ("Pre-existing Materials"). To the extent any Pre-existing Materials are incorporated into the Work Product, {serviceprovider} grants {company} a non-exclusive, royalty-free, perpetual, worldwide license to use such Pre-existing Materials solely as part of the Work Product.'},{id:"5.4",title:"Third-Party Materials",content:"If the Work Product incorporates any third-party materials (including open-source software), {serviceprovider} shall identify such materials and their applicable license terms. {company} agrees to comply with all such third-party license terms. {serviceprovider} makes no representations regarding the suitability of such third-party materials for {company}'s intended use."},{id:"5.5",title:"Moral Rights",content:"To the extent permitted by applicable law, {serviceprovider} waives and agrees not to assert any moral rights in the Work Product, including rights of attribution, integrity, and disclosure."},{id:"5.6",title:"Further Assurances",content:"{serviceprovider} agrees to execute any documents and take any actions reasonably requested by {company} to perfect, register, or enforce {company}'s rights in the Work Product, at {company}'s expense."},{id:"5.7",title:"Portfolio Rights",content:"{serviceprovider} retains the right to display, reference, and describe the Work Product (excluding Confidential Information) in {serviceprovider}'s portfolio, marketing materials, and similar promotional contexts, unless {company} provides written notice to the contrary."}]},{id:"6",title:"Confidentiality",toggleKey:"confidentiality",subsections:[{id:"6.1",title:"Definition",content:'"Confidential Information" means any non-public information disclosed by one party (the "Discloser") to the other party (the "Recipient") in connection with this Agreement, whether oral, written, electronic, or otherwise, that is designated as confidential or that reasonably should be understood to be confidential given the nature of the information and circumstances of disclosure. Confidential Information includes, without limitation, business plans, technical data, trade secrets, customer information, financial information, and proprietary processes.'},{id:"6.2",title:"Obligations",content:"The Recipient shall: (a) hold the Confidential Information in strict confidence; (b) not disclose the Confidential Information to any third party except as expressly permitted herein; (c) use the Confidential Information only for purposes of performing or receiving the Services; and (d) protect the Confidential Information using at least the same degree of care it uses to protect its own confidential information, but in no event less than reasonable care. The Recipient may disclose Confidential Information to its employees, contractors, and advisors who have a need to know and are bound by confidentiality obligations at least as protective as those herein."},{id:"6.3",title:"Exceptions",content:"Confidential Information does not include information that: (a) is or becomes publicly available through no fault of the Recipient; (b) was rightfully known to the Recipient prior to disclosure; (c) is rightfully obtained by the Recipient from a third party without restriction; or (d) is independently developed by the Recipient without use of the Confidential Information. The Recipient may disclose Confidential Information if required by law, provided the Recipient gives the Discloser prompt notice and reasonable assistance to seek a protective order."}]},{id:"7",title:"Ownership and Return of Materials",toggleKey:"confidentiality",subsections:[{id:"7.1",title:"Return of Materials",content:"Upon termination of this Agreement or upon the Discloser's written request, the Recipient shall promptly return or destroy all Confidential Information and any copies thereof, and shall certify in writing that it has done so. Notwithstanding the foregoing, the Recipient may retain copies of Confidential Information to the extent required by applicable law or for legitimate archival purposes, subject to continued confidentiality obligations."}]},{id:"8",title:"Indemnification and Limitation of Liability",toggleKey:"limitationOfLiability",subsections:[{id:"8.1",title:"Mutual Indemnification",content:`Each party (the "Indemnifying Party") agrees to indemnify, defend, and hold harmless the other party and its officers, directors, employees, and agents (collectively, the "Indemnified Parties") from and against any claims, damages, losses, liabilities, costs, and expenses (including reasonable attorneys' fees) arising out of or relating to: (a) the Indemnifying Party's breach of any representation, warranty, or obligation under this Agreement; (b) the Indemnifying Party's negligence or willful misconduct; or (c) any third-party claim that the Indemnifying Party's materials infringe such third party's intellectual property rights.`},{id:"8.2",title:"Limitation of Liability",content:"EXCEPT FOR BREACHES OF CONFIDENTIALITY, INDEMNIFICATION OBLIGATIONS, OR WILLFUL MISCONDUCT, NEITHER PARTY SHALL BE LIABLE TO THE OTHER FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING LOSS OF PROFITS, REVENUE, DATA, OR USE, REGARDLESS OF THE THEORY OF LIABILITY, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES."},{id:"8.3",title:"Liability Cap",content:"EXCEPT FOR BREACHES OF CONFIDENTIALITY, INDEMNIFICATION OBLIGATIONS, OR WILLFUL MISCONDUCT, THE TOTAL AGGREGATE LIABILITY OF EITHER PARTY ARISING OUT OF OR RELATING TO THIS AGREEMENT SHALL NOT EXCEED THE TOTAL AMOUNTS PAID OR PAYABLE BY {company} TO {serviceprovider} UNDER THIS AGREEMENT DURING THE TWELVE (12) MONTHS PRECEDING THE CLAIM."}]},{id:"9",title:"No Conflict of Interest",toggleKey:"nonSolicitation",subsections:[{id:"9.1",title:"Non-Solicitation",content:"During the term of this Agreement and for a period of twelve (12) months thereafter, neither party shall directly or indirectly solicit, recruit, or hire any employee or contractor of the other party who was involved in the performance or receipt of the Services, without the other party's prior written consent. This restriction shall not apply to general employment advertisements or unsolicited applications."},{id:"9.2",title:"No Exclusivity",content:"Unless otherwise expressly agreed in writing, this Agreement does not create an exclusive relationship between the parties. {serviceprovider} is free to provide similar services to other clients, and {company} is free to engage other service providers, provided that such activities do not breach the confidentiality or intellectual property provisions herein."}]},{id:"10",title:"Term and Termination",subsections:[{id:"10.1",title:"Term",content:"This Agreement shall commence on the Effective Date ({effectivedate}) and shall continue until the completion of the Services or {terminationdate}, whichever occurs first, unless earlier terminated in accordance with this Section."},{id:"10.2",title:"Termination for Convenience",content:"Either party may terminate this Agreement for any reason upon {noticeperiod} days' prior written notice to the other party. Upon such termination, {company} shall pay {serviceprovider} for all Services satisfactorily performed through the effective date of termination."},{id:"10.3",title:"Termination for Cause",content:"Either party may terminate this Agreement immediately upon written notice if the other party: (a) materially breaches this Agreement and fails to cure such breach within fifteen (15) days after receiving written notice thereof; (b) becomes insolvent or files or has filed against it a petition in bankruptcy; or (c) ceases to do business in the normal course."},{id:"10.4",title:"Effect of Termination",content:"Upon termination: (a) all licenses granted hereunder shall terminate, except as otherwise provided; (b) each party shall return or destroy the other party's Confidential Information; (c) {company} shall pay all amounts due for Services performed through the termination date; and (d) the provisions of Sections relating to intellectual property (upon full payment), confidentiality, indemnification, limitation of liability, and general provisions shall survive termination."}]},{id:"11",title:"Support and Warranty Period",subsections:[{id:"11.1",title:"Support Period",content:"Following delivery and acceptance of the Work Product, {serviceprovider} shall provide support for a period of {supportperiod} to address any defects or bugs in the Work Product that prevent it from performing materially in accordance with its specifications. This support is limited to fixing defects and does not include enhancements, new features, or changes requested by {company}."},{id:"11.2",title:"Warranty Disclaimer",content:`EXCEPT AS EXPRESSLY SET FORTH IN THIS AGREEMENT, {serviceprovider} PROVIDES THE SERVICES AND WORK PRODUCT "AS IS" AND MAKES NO WARRANTIES, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, OR NON-INFRINGEMENT. {serviceprovider} DOES NOT WARRANT THAT THE SERVICES OR WORK PRODUCT WILL BE ERROR-FREE, UNINTERRUPTED, OR MEET {company}'S SPECIFIC REQUIREMENTS.`}]},{id:"12",title:"General Provisions",subsections:[{id:"12.1",title:"Governing Law",content:"This Agreement shall be governed by and construed in accordance with the laws of {governinglaw}, without regard to its conflicts of law principles. Any disputes arising under or relating to this Agreement shall be resolved in the courts of competent jurisdiction in {governinglaw}."},{id:"12.2",title:"Entire Agreement",content:"This Agreement constitutes the entire agreement between the parties with respect to the subject matter hereof and supersedes all prior and contemporaneous agreements, representations, and understandings, whether written or oral. No modification of this Agreement shall be binding unless in writing and signed by both parties."},{id:"12.3",title:"Severability",content:"If any provision of this Agreement is held to be invalid, illegal, or unenforceable, such provision shall be modified to the minimum extent necessary to make it valid, legal, and enforceable, or if modification is not possible, shall be severed from this Agreement. The remaining provisions shall continue in full force and effect."},{id:"12.4",title:"Waiver",content:"The failure of either party to enforce any right or provision of this Agreement shall not constitute a waiver of such right or provision. Any waiver must be in writing and signed by the waiving party."},{id:"12.5",title:"Assignment",content:"Neither party may assign or transfer this Agreement or any rights or obligations hereunder without the prior written consent of the other party, except that either party may assign this Agreement in connection with a merger, acquisition, or sale of all or substantially all of its assets. This Agreement shall be binding upon and inure to the benefit of the parties and their permitted successors and assigns."},{id:"12.6",title:"Independent Contractor",content:"{serviceprovider} is an independent contractor and not an employee, agent, partner, or joint venturer of {company}. {serviceprovider} shall be solely responsible for all taxes, benefits, and insurance arising from {serviceprovider}'s performance under this Agreement. Nothing in this Agreement shall be construed to create an employment or agency relationship between the parties."},{id:"12.7",title:"Notices",content:"All notices under this Agreement shall be in writing and shall be deemed given when delivered personally, sent by confirmed email, or sent by recognized overnight courier to the addresses set forth in this Agreement or such other address as a party may designate by notice."}]}]},Et={version:"1.0.0",sections:[{id:"5",title:"الملكية الفكرية",toggleKey:"ipOwnership",subsections:[{id:"5.1",title:"نتاج العمل",content:'في هذه الاتفاقية، يُقصد بـ "نتاج العمل" جميع الاكتشافات والتصاميم والتطويرات والتحسينات والاختراعات (سواء كانت قابلة للحماية ببراءة اختراع أم لا) والمصنفات الفكرية والأسرار التجارية والبرمجيات والكود المصدري والوثائق والبيانات التقنية وأي أعمال ومواد ومخرجات أخرى ينشئها أو يبتكرها أو يطورها {serviceprovider} بمفرده أو بالاشتراك مع آخرين في سياق تقديم الخدمات.'},{id:"5.2",title:"التنازل عن نتاج العمل",content:"عند السداد الكامل لجميع المبالغ المستحقة بموجب هذه الاتفاقية، يتنازل {serviceprovider} بموجب هذا بشكل نهائي لصالح {company} عن كافة الحقوق والملكية والمصالح في نتاج العمل، بما في ذلك جميع حقوق الملكية الفكرية المتعلقة به. وحتى يتم السداد الكامل، يحتفظ {serviceprovider} بملكية نتاج العمل، ولا يحق لـ {company} استخدام أو تعديل أو توزيع نتاج العمل."},{id:"5.3",title:"المواد الموجودة مسبقاً",content:'يحتفظ {serviceprovider} بجميع الحقوق والملكية والمصالح في أي مواد أو أدوات أو مكتبات أو إطارات عمل أو ملكية فكرية مملوكة لـ {serviceprovider} أو مرخصة له قبل تاريخ السريان أو مطورة بشكل مستقل خارج نطاق هذه الاتفاقية ("المواد الموجودة مسبقاً"). وبقدر ما يتم دمج أي مواد موجودة مسبقاً في نتاج العمل، يمنح {serviceprovider} لـ {company} ترخيصاً غير حصري وخالٍ من الإتاوات ودائماً وعالمياً لاستخدام هذه المواد الموجودة مسبقاً فقط كجزء من نتاج العمل.'},{id:"5.4",title:"مواد الطرف الثالث",content:"إذا تضمن نتاج العمل أي مواد من طرف ثالث (بما في ذلك البرمجيات مفتوحة المصدر)، يجب على {serviceprovider} تحديد هذه المواد وشروط الترخيص المعمول بها. يوافق {company} على الالتزام بجميع شروط ترخيص الطرف الثالث هذه. لا يقدم {serviceprovider} أي تعهدات بشأن ملاءمة مواد الطرف الثالث هذه للاستخدام المقصود من قبل {company}."},{id:"5.5",title:"الحقوق المعنوية",content:"إلى الحد الذي يسمح به القانون المعمول به، يتنازل {serviceprovider} ويوافق على عدم المطالبة بأي حقوق معنوية في نتاج العمل، بما في ذلك حقوق النسب والسلامة والإفصاح."},{id:"5.6",title:"ضمانات إضافية",content:"يوافق {serviceprovider} على تنفيذ أي مستندات واتخاذ أي إجراءات يطلبها {company} بشكل معقول لإتقان أو تسجيل أو إنفاذ حقوق {company} في نتاج العمل، على نفقة {company}."},{id:"5.7",title:"حقوق المحفظة",content:"يحتفظ {serviceprovider} بالحق في عرض والإشارة إلى ووصف نتاج العمل (باستثناء المعلومات السرية) في محفظة {serviceprovider} والمواد التسويقية والسياقات الترويجية المماثلة، ما لم يقدم {company} إشعاراً كتابياً بخلاف ذلك."}]},{id:"6",title:"السرية",toggleKey:"confidentiality",subsections:[{id:"6.1",title:"التعريف",content:'يُقصد بـ "المعلومات السرية" أي معلومات غير عامة يفصح عنها أحد الطرفين ("المُفصِح") للطرف الآخر ("المُتلقي") فيما يتعلق بهذه الاتفاقية، سواء كانت شفهية أو مكتوبة أو إلكترونية أو غير ذلك، والتي تم تصنيفها على أنها سرية أو التي يجب أن يُفهم بشكل معقول أنها سرية بالنظر إلى طبيعة المعلومات وظروف الإفصاح. تشمل المعلومات السرية، على سبيل المثال لا الحصر، خطط الأعمال والبيانات التقنية والأسرار التجارية ومعلومات العملاء والمعلومات المالية والعمليات الخاصة.'},{id:"6.2",title:"الالتزامات",content:"يجب على المُتلقي: (أ) الحفاظ على المعلومات السرية بسرية تامة؛ (ب) عدم الإفصاح عن المعلومات السرية لأي طرف ثالث إلا بموجب الإذن الصريح في هذه الاتفاقية؛ (ج) استخدام المعلومات السرية فقط لأغراض تنفيذ أو تلقي الخدمات؛ و(د) حماية المعلومات السرية باستخدام نفس درجة العناية على الأقل التي يستخدمها لحماية معلوماته السرية الخاصة، ولكن في جميع الأحوال لا تقل عن العناية المعقولة. يجوز للمُتلقي الإفصاح عن المعلومات السرية لموظفيه ومقاوليه ومستشاريه الذين لديهم حاجة للمعرفة والملتزمين بالتزامات السرية بنفس درجة الحماية على الأقل."},{id:"6.3",title:"الاستثناءات",content:"لا تشمل المعلومات السرية المعلومات التي: (أ) أصبحت أو تصبح متاحة للعموم دون خطأ من المُتلقي؛ (ب) كانت معروفة بشكل مشروع للمُتلقي قبل الإفصاح؛ (ج) حصل عليها المُتلقي بشكل مشروع من طرف ثالث دون قيود؛ أو (د) طورها المُتلقي بشكل مستقل دون استخدام المعلومات السرية. يجوز للمُتلقي الإفصاح عن المعلومات السرية إذا كان ذلك مطلوباً بموجب القانون، شريطة أن يقدم المُتلقي إشعاراً فورياً للمُفصِح ومساعدة معقولة للحصول على أمر حماية."}]},{id:"7",title:"ملكية المواد وإعادتها",toggleKey:"confidentiality",subsections:[{id:"7.1",title:"إعادة المواد",content:"عند إنهاء هذه الاتفاقية أو بناءً على طلب كتابي من المُفصِح، يجب على المُتلقي إعادة أو إتلاف جميع المعلومات السرية وأي نسخ منها على الفور، ويجب أن يُقدم شهادة كتابية بأنه قام بذلك. وبصرف النظر عما سبق، يجوز للمُتلقي الاحتفاظ بنسخ من المعلومات السرية إلى الحد الذي يتطلبه القانون المعمول به أو لأغراض الأرشفة المشروعة، مع مراعاة استمرار التزامات السرية."}]},{id:"8",title:"التعويض وتحديد المسؤولية",toggleKey:"limitationOfLiability",subsections:[{id:"8.1",title:"التعويض المتبادل",content:'يوافق كل طرف ("الطرف المُعوِّض") على تعويض الطرف الآخر ومسؤوليه ومديريه وموظفيه ووكلائه (مجتمعين، "الأطراف المُعوَّضة") والدفاع عنهم وإبراء ذمتهم من وضد أي مطالبات أو أضرار أو خسائر أو التزامات أو تكاليف ونفقات (بما في ذلك أتعاب المحاماة المعقولة) الناشئة عن أو المتعلقة بـ: (أ) إخلال الطرف المُعوِّض بأي تعهد أو ضمان أو التزام بموجب هذه الاتفاقية؛ (ب) إهمال الطرف المُعوِّض أو سوء السلوك المتعمد؛ أو (ج) أي مطالبة من طرف ثالث بأن مواد الطرف المُعوِّض تنتهك حقوق الملكية الفكرية لهذا الطرف الثالث.'},{id:"8.2",title:"تحديد المسؤولية",content:"باستثناء انتهاكات السرية والتزامات التعويض أو سوء السلوك المتعمد، لن يكون أي من الطرفين مسؤولاً تجاه الآخر عن أي أضرار غير مباشرة أو عرضية أو خاصة أو تبعية أو عقابية، بما في ذلك خسارة الأرباح أو الإيرادات أو البيانات أو الاستخدام، بغض النظر عن نظرية المسؤولية، حتى لو تم إبلاغه بإمكانية حدوث مثل هذه الأضرار."},{id:"8.3",title:"سقف المسؤولية",content:"باستثناء انتهاكات السرية والتزامات التعويض أو سوء السلوك المتعمد، لن تتجاوز المسؤولية الإجمالية الكلية لأي من الطرفين الناشئة عن أو المتعلقة بهذه الاتفاقية إجمالي المبالغ المدفوعة أو المستحقة الدفع من قبل {company} لـ {serviceprovider} بموجب هذه الاتفاقية خلال الاثني عشر (12) شهراً السابقة للمطالبة."}]},{id:"9",title:"عدم تعارض المصالح",toggleKey:"nonSolicitation",subsections:[{id:"9.1",title:"عدم الاستقطاب",content:"خلال مدة هذه الاتفاقية ولفترة اثني عشر (12) شهراً بعدها، لا يجوز لأي من الطرفين بشكل مباشر أو غير مباشر استقطاب أو توظيف أو تعيين أي موظف أو مقاول لدى الطرف الآخر كان مشاركاً في تنفيذ أو تلقي الخدمات، دون موافقة كتابية مسبقة من الطرف الآخر. لا ينطبق هذا القيد على إعلانات التوظيف العامة أو الطلبات غير المطلوبة."},{id:"9.2",title:"عدم الحصرية",content:"ما لم يُتفق على خلاف ذلك صراحةً بالكتابة، لا تُنشئ هذه الاتفاقية علاقة حصرية بين الطرفين. يحق لـ {serviceprovider} تقديم خدمات مماثلة لعملاء آخرين، ويحق لـ {company} التعاقد مع مقدمي خدمات آخرين، شريطة ألا تنتهك هذه الأنشطة أحكام السرية أو الملكية الفكرية الواردة في هذه الاتفاقية."}]},{id:"10",title:"المدة والإنهاء",subsections:[{id:"10.1",title:"المدة",content:"تبدأ هذه الاتفاقية من تاريخ السريان ({effectivedate}) وتستمر حتى إتمام الخدمات أو {terminationdate}، أيهما يحدث أولاً، ما لم يتم إنهاؤها مبكراً وفقاً لهذا البند."},{id:"10.2",title:"الإنهاء للراحة",content:"يجوز لأي من الطرفين إنهاء هذه الاتفاقية لأي سبب بموجب إشعار كتابي مسبق قبل {noticeperiod} يوماً للطرف الآخر. عند هذا الإنهاء، يجب على {company} دفع مقابل جميع الخدمات المُنجزة بشكل مُرضٍ حتى تاريخ سريان الإنهاء."},{id:"10.3",title:"الإنهاء لسبب",content:"يجوز لأي من الطرفين إنهاء هذه الاتفاقية فوراً بموجب إشعار كتابي إذا: (أ) أخل الطرف الآخر إخلالاً جوهرياً بهذه الاتفاقية وفشل في معالجة هذا الإخلال خلال خمسة عشر (15) يوماً من تلقي إشعار كتابي بذلك؛ (ب) أصبح الطرف الآخر معسراً أو قدم أو قُدم ضده طلب إفلاس؛ أو (ج) توقف الطرف الآخر عن ممارسة أعماله بالطريقة المعتادة."},{id:"10.4",title:"أثر الإنهاء",content:"عند الإنهاء: (أ) تنتهي جميع التراخيص الممنوحة بموجب هذه الاتفاقية، إلا بموجب ما هو منصوص عليه خلافاً لذلك؛ (ب) يجب على كل طرف إعادة أو إتلاف المعلومات السرية للطرف الآخر؛ (ج) يجب على {company} دفع جميع المبالغ المستحقة مقابل الخدمات المُنجزة حتى تاريخ الإنهاء؛ و(د) تظل الأحكام المتعلقة بالملكية الفكرية (عند السداد الكامل) والسرية والتعويض وتحديد المسؤولية والأحكام العامة سارية بعد الإنهاء."}]},{id:"11",title:"الدعم وفترة الضمان",subsections:[{id:"11.1",title:"فترة الدعم",content:"بعد تسليم نتاج العمل وقبوله، يجب على {serviceprovider} تقديم الدعم لفترة {supportperiod} لمعالجة أي عيوب أو أخطاء في نتاج العمل تمنعه من الأداء بشكل جوهري وفقاً لمواصفاته. يقتصر هذا الدعم على إصلاح العيوب ولا يشمل التحسينات أو الميزات الجديدة أو التغييرات التي يطلبها {company}."},{id:"11.2",title:"إخلاء الضمان",content:'باستثناء ما هو منصوص عليه صراحةً في هذه الاتفاقية، يُقدم {serviceprovider} الخدمات ونتاج العمل "كما هي" ولا يُقدم أي ضمانات صريحة أو ضمنية، بما في ذلك على سبيل المثال لا الحصر الضمانات الضمنية للرواج أو الملاءمة لغرض معين أو الملكية أو عدم الانتهاك. لا يضمن {serviceprovider} أن الخدمات أو نتاج العمل ستكون خالية من الأخطاء أو دون انقطاع أو تلبي المتطلبات المحددة لـ {company}.'}]},{id:"12",title:"الأحكام العامة",subsections:[{id:"12.1",title:"القانون الحاكم",content:"تخضع هذه الاتفاقية وتُفسر وفقاً لقوانين {governinglaw}، دون مراعاة مبادئ تعارض القوانين. يتم حل أي نزاعات ناشئة بموجب أو متعلقة بهذه الاتفاقية في المحاكم ذات الاختصاص القضائي في {governinglaw}."},{id:"12.2",title:"الاتفاقية الكاملة",content:"تُشكل هذه الاتفاقية الاتفاقية الكاملة بين الطرفين فيما يتعلق بالموضوع الوارد فيها وتحل محل جميع الاتفاقيات والتعهدات والتفاهمات السابقة والمعاصرة، سواء كانت مكتوبة أو شفهية. لا يكون أي تعديل على هذه الاتفاقية ملزماً ما لم يكن كتابياً وموقعاً من كلا الطرفين."},{id:"12.3",title:"قابلية الفصل",content:"إذا تم اعتبار أي حكم من أحكام هذه الاتفاقية باطلاً أو غير قانوني أو غير قابل للتنفيذ، يتم تعديل هذا الحكم إلى الحد الأدنى اللازم لجعله صالحاً وقانونياً وقابلاً للتنفيذ، أو إذا لم يكن التعديل ممكناً، يتم فصله عن هذه الاتفاقية. تظل الأحكام المتبقية سارية المفعول بالكامل."},{id:"12.4",title:"التنازل",content:"لا يُشكل عدم قيام أي من الطرفين بإنفاذ أي حق أو حكم من أحكام هذه الاتفاقية تنازلاً عن هذا الحق أو الحكم. يجب أن يكون أي تنازل كتابياً وموقعاً من الطرف المتنازل."},{id:"12.5",title:"التنازل عن الاتفاقية",content:"لا يجوز لأي من الطرفين التنازل عن هذه الاتفاقية أو نقلها أو أي حقوق أو التزامات بموجبها دون موافقة كتابية مسبقة من الطرف الآخر، باستثناء أنه يجوز لأي من الطرفين التنازل عن هذه الاتفاقية فيما يتعلق بالاندماج أو الاستحواذ أو بيع جميع أصوله أو معظمها. تكون هذه الاتفاقية ملزمة ونافذة لصالح الطرفين وخلفائهم والمتنازل لهم المصرح بهم."},{id:"12.6",title:"المقاول المستقل",content:"{serviceprovider} هو مقاول مستقل وليس موظفاً أو وكيلاً أو شريكاً أو متعاقداً مشتركاً لـ {company}. يكون {serviceprovider} وحده مسؤولاً عن جميع الضرائب والمزايا والتأمينات الناشئة عن أداء {serviceprovider} بموجب هذه الاتفاقية. لا يجوز تفسير أي شيء في هذه الاتفاقية على أنه ينشئ علاقة توظيف أو وكالة بين الطرفين."},{id:"12.7",title:"الإشعارات",content:"يجب أن تكون جميع الإشعارات بموجب هذه الاتفاقية كتابية وتُعتبر مُقدمة عند تسليمها شخصياً أو إرسالها بالبريد الإلكتروني المؤكد أو إرسالها بواسطة شركة بريد معترف بها إلى العناوين المحددة في هذه الاتفاقية أو أي عنوان آخر قد يحدده أي طرف بموجب إشعار."}]}]};function Ie(t){return t?new Date(t).toLocaleDateString("en-GB",{day:"2-digit",month:"long",year:"numeric"}):"_______________"}function Dt(t){return{serviceprovider:t.profileName||"Service Provider",company:t.clientName||"Client",effectivedate:Ie(t.startDate),terminationdate:Ie(t.endDate),noticeperiod:String(t.terminationNoticeDays||14),governinglaw:t.governingLaw||"the applicable jurisdiction",supportperiod:"six (6) months"}}function xe(t,n){return Object.entries(n).reduce((i,[s,c])=>i.replace(new RegExp(`\\{${s}\\}`,"gi"),String(c??"")),t)}function It(t){return t==="ar"?Et:Ct}function Tt(t,n){return t.sections.filter(i=>i.toggleKey?!!n[i.toggleKey]:!0)}function Pt(t,n){const i=It(t),s=Tt(i,n),c=Dt(n);return s.map(l=>({...l,title:xe(l.title,c),subsections:l.subsections.map(r=>({...r,title:r.title?xe(r.title,c):void 0,content:xe(r.content,c)}))}))}function Rt(t){return/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(t)}function me(t,n){return Rt(t)?"IBMPlexSansArabic":n}const O=je.create({brandedHeader:{position:"absolute",top:20,left:20,right:20,flexDirection:"row",justifyContent:"space-between",paddingBottom:15,borderBottomWidth:1,borderBottomColor:"#e5e7eb"},brandedHeaderRtl:{flexDirection:"row-reverse"},logoSection:{flexDirection:"row",alignItems:"center",gap:12},logoSectionRtl:{flexDirection:"row-reverse"},logo:{width:50,height:50,objectFit:"contain"},businessInfo:{flexDirection:"column"},businessName:{fontSize:16,fontWeight:700,marginBottom:2},businessDetail:{fontSize:9,color:"#666666",marginTop:1},contactInfo:{flexDirection:"column",alignItems:"flex-end"},contactInfoRtl:{alignItems:"flex-start"},contactText:{fontSize:9,color:"#666666",marginTop:1}});function ve(t,n){const i=t/100,c={USD:"$",ILS:"₪",EUR:"€"}[n]||"",l=i.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});return`${c}${l}`}function fe(t){return new Date(t).toLocaleDateString("en-GB",{day:"2-digit",month:"2-digit",year:"numeric"})}function At({snapshot:t,client:n,language:i,type:s,category:c,profile:l}){const r=Ne(i),d=St(i),u=kt(i),p=i==="ar",a=je.create({page:{fontFamily:d},text:{fontFamily:d,textAlign:u},row:{flexDirection:p?"row-reverse":"row"}}),N=s==="task",S=Pt(i,t),v=l?i==="ar"?l.name:l.nameEn||l.name:r.provider,b=l?i==="ar"?l.address1:l.address1En||l.address1:void 0,k=l?i==="ar"?l.city:l.cityEn||l.city:void 0,E=!!l?.logoDataUrl,A=me(v,d),L=me(n?.name||t.clientName||"",d);return e.jsx(nt,{children:e.jsxs(st,{size:"A4",style:[o.page,a.page,l?{paddingTop:90}:{}],children:[l&&e.jsxs(f,{style:p?[O.brandedHeader,O.brandedHeaderRtl]:O.brandedHeader,fixed:!0,children:[e.jsxs(f,{style:p?[O.logoSection,O.logoSectionRtl]:O.logoSection,children:[E&&e.jsx(at,{src:l.logoDataUrl,style:O.logo}),e.jsxs(f,{style:O.businessInfo,children:[e.jsx(x,{style:[O.businessName,{fontFamily:A,textAlign:u}],children:v}),b&&e.jsx(x,{style:[O.businessDetail,{fontFamily:me(b,d),textAlign:u}],children:b}),k&&e.jsx(x,{style:[O.businessDetail,{fontFamily:me(k,d),textAlign:u}],children:k})]})]}),e.jsxs(f,{style:p?[O.contactInfo,O.contactInfoRtl]:O.contactInfo,children:[l.email&&e.jsx(x,{style:[O.contactText,{fontFamily:d}],children:l.email}),l.phone&&e.jsx(x,{style:[O.contactText,{fontFamily:d}],children:l.phone}),l.website&&e.jsx(x,{style:[O.contactText,{fontFamily:d}],children:l.website})]})]}),e.jsxs(f,{style:o.header,children:[e.jsx(x,{style:[o.title,a.text],children:wt(s,i)}),e.jsx(x,{style:[o.subtitle,a.text],children:Nt(c,i)})]}),e.jsxs(f,{style:[o.partiesSection,a.row],children:[e.jsxs(f,{style:o.partyBox,children:[e.jsx(x,{style:[o.partyTitle,a.text],children:r.provider}),e.jsx(x,{style:[o.partyName,{fontFamily:A,textAlign:u}],children:v})]}),e.jsxs(f,{style:o.partyBox,children:[e.jsx(x,{style:[o.partyTitle,a.text],children:r.client}),e.jsx(x,{style:[o.partyName,{fontFamily:L,textAlign:u}],children:n?.name||t.clientName||"-"}),n?.email&&e.jsx(x,{style:[{fontSize:10},a.text],children:n.email})]})]}),(t.title||t.summary)&&e.jsxs(f,{style:o.section,children:[e.jsx(x,{style:[o.sectionTitle,a.text],children:r.summary}),e.jsxs(f,{style:o.sectionContent,children:[t.title&&e.jsx(x,{style:[o.paragraph,a.text,{fontWeight:600}],children:t.title}),t.summary&&e.jsx(x,{style:[o.paragraph,a.text],children:t.summary})]})]}),t.deliverables&&t.deliverables.length>0&&e.jsxs(f,{style:o.section,children:[e.jsx(x,{style:[o.sectionTitle,a.text],children:r.deliverables}),e.jsx(f,{style:o.list,children:t.deliverables.map((h,m)=>e.jsxs(f,{style:o.listItem,children:[e.jsx(x,{style:o.listBullet,children:"•"}),e.jsxs(x,{style:[o.listContent,a.text],children:[h.description,h.quantity?` (${h.quantity})`:"",h.format?` - ${h.format}`:""]})]},h.id||m))})]}),t.exclusions&&t.exclusions.length>0&&e.jsxs(f,{style:o.section,children:[e.jsx(x,{style:[o.sectionTitle,a.text],children:r.exclusions}),e.jsx(f,{style:o.list,children:t.exclusions.map((h,m)=>e.jsxs(f,{style:o.listItem,children:[e.jsx(x,{style:o.listBullet,children:"•"}),e.jsx(x,{style:[o.listContent,a.text],children:h})]},m))})]}),t.dependencies&&t.dependencies.length>0&&e.jsxs(f,{style:o.section,children:[e.jsx(x,{style:[o.sectionTitle,a.text],children:r.dependencies}),e.jsx(f,{style:o.list,children:t.dependencies.map((h,m)=>e.jsxs(f,{style:o.listItem,children:[e.jsx(x,{style:o.listBullet,children:"•"}),e.jsx(x,{style:[o.listContent,a.text],children:h})]},m))})]}),e.jsxs(f,{style:o.section,children:[e.jsx(x,{style:[o.sectionTitle,a.text],children:r.timeline}),e.jsxs(f,{style:o.sectionContent,children:[t.startDate&&e.jsxs(f,{style:o.infoRow,children:[e.jsxs(x,{style:[o.infoLabel,a.text],children:[r.startDate,":"]}),e.jsx(x,{style:[o.infoValue,a.text],children:fe(t.startDate)})]}),t.endDate&&e.jsxs(f,{style:o.infoRow,children:[e.jsxs(x,{style:[o.infoLabel,a.text],children:[r.endDate,":"]}),e.jsx(x,{style:[o.infoValue,a.text],children:fe(t.endDate)})]}),e.jsxs(f,{style:o.infoRow,children:[e.jsxs(x,{style:[o.infoLabel,a.text],children:[r.reviewWindow,":"]}),e.jsxs(x,{style:[o.infoValue,a.text],children:[t.reviewWindowDays," ",r.days]})]})]})]}),t.milestones&&t.milestones.length>0&&e.jsxs(f,{style:o.section,children:[e.jsx(x,{style:[o.sectionTitle,a.text],children:r.milestones}),e.jsx(f,{style:o.table,children:t.milestones.map((h,m)=>e.jsxs(f,{style:o.tableRow,children:[e.jsx(x,{style:[o.tableCell,a.text,{flex:2}],children:h.title}),e.jsx(x,{style:[o.tableCell,a.text,{flex:1}],children:h.targetDate?fe(h.targetDate):"-"})]},h.id||m))})]}),e.jsxs(f,{style:o.section,children:[e.jsx(x,{style:[o.sectionTitle,a.text],children:r.reviews}),e.jsxs(f,{style:o.sectionContent,children:[e.jsxs(f,{style:o.infoRow,children:[e.jsxs(x,{style:[o.infoLabel,a.text],children:[r.revisionRounds,":"]}),e.jsxs(x,{style:[o.infoValue,a.text],children:[t.revisionRounds," ",r.rounds]})]}),t.bugFixDays&&e.jsxs(f,{style:o.infoRow,children:[e.jsxs(x,{style:[o.infoLabel,a.text],children:[r.bugFixPeriod,":"]}),e.jsxs(x,{style:[o.infoValue,a.text],children:[t.bugFixDays," ",r.days]})]})]})]}),e.jsxs(f,{style:o.section,children:[e.jsx(x,{style:[o.sectionTitle,a.text],children:r.payment}),e.jsxs(f,{style:o.sectionContent,children:[N&&t.totalAmountMinor?e.jsxs(e.Fragment,{children:[e.jsxs(f,{style:o.infoRow,children:[e.jsxs(x,{style:[o.infoLabel,a.text],children:[r.totalAmount,":"]}),e.jsx(x,{style:[o.amount,a.text],children:ve(t.totalAmountMinor,t.currency)})]}),t.depositPercent?e.jsxs(f,{style:o.infoRow,children:[e.jsxs(x,{style:[o.infoLabel,a.text],children:[r.deposit,":"]}),e.jsxs(x,{style:[o.infoValue,a.text],children:[t.depositPercent,r.percent]})]}):null]}):e.jsxs(e.Fragment,{children:[t.retainerAmountMinor?e.jsxs(f,{style:o.infoRow,children:[e.jsxs(x,{style:[o.infoLabel,a.text],children:[r.retainerAmount,":"]}),e.jsx(x,{style:[o.amount,a.text],children:ve(t.retainerAmountMinor,t.currency)})]}):null,t.billingDay&&e.jsxs(f,{style:o.infoRow,children:[e.jsxs(x,{style:[o.infoLabel,a.text],children:[r.billingDay,":"]}),e.jsx(x,{style:[o.infoValue,a.text],children:t.billingDay})]})]}),e.jsxs(f,{style:o.infoRow,children:[e.jsxs(x,{style:[o.infoLabel,a.text],children:[r.lateFee,":"]}),e.jsx(x,{style:[o.infoValue,a.text],children:t.lateFeeEnabled?r.enabled:r.disabled})]})]})]}),N&&t.scheduleItems&&t.scheduleItems.length>0&&e.jsxs(f,{style:o.section,children:[e.jsx(x,{style:[o.sectionTitle,a.text],children:r.paymentSchedule}),e.jsx(f,{style:o.table,children:t.scheduleItems.map((h,m)=>e.jsxs(f,{style:o.tableRow,children:[e.jsx(x,{style:[o.tableCell,a.text,{flex:2}],children:h.label||Lt(h.trigger,r)}),e.jsx(x,{style:[o.tableCell,a.text,{flex:1,textAlign:"right"}],children:ve(h.amountMinor,h.currency)})]},h.id||m))})]}),e.jsxs(f,{style:o.section,children:[e.jsx(x,{style:[o.sectionTitle,a.text],children:r.relationship}),e.jsxs(f,{style:o.sectionContent,children:[e.jsxs(f,{style:o.infoRow,children:[e.jsxs(x,{style:[o.infoLabel,a.text],children:[r.termType,":"]}),e.jsx(x,{style:[o.infoValue,a.text],children:t.termType==="month-to-month"?r.monthToMonth:r.fixed})]}),e.jsxs(f,{style:o.infoRow,children:[e.jsxs(x,{style:[o.infoLabel,a.text],children:[r.terminationNotice,":"]}),e.jsxs(x,{style:[o.infoValue,a.text],children:[t.terminationNoticeDays," ",r.days]})]}),t.cancellationCoveragePercent?e.jsxs(f,{style:o.infoRow,children:[e.jsxs(x,{style:[o.infoLabel,a.text],children:[r.cancellationCoverage,":"]}),e.jsxs(x,{style:[o.infoValue,a.text],children:[t.cancellationCoveragePercent,r.percent]})]}):null,e.jsxs(f,{style:o.infoRow,children:[e.jsxs(x,{style:[o.infoLabel,a.text],children:[r.ownershipTransfer,":"]}),e.jsx(x,{style:[o.infoValue,a.text],children:t.ownershipTransferRule?.replace(/_/g," ")||"-"})]})]})]}),e.jsxs(f,{style:o.section,children:[e.jsx(x,{style:[o.sectionTitle,a.text],children:r.terms}),e.jsxs(f,{style:o.badgesRow,children:[t.confidentiality&&e.jsx(f,{style:o.badge,children:e.jsx(x,{style:a.text,children:r.confidentiality})}),t.ipOwnership&&e.jsx(f,{style:o.badge,children:e.jsx(x,{style:a.text,children:r.ipOwnership})}),t.warrantyDisclaimer&&e.jsx(f,{style:o.badge,children:e.jsx(x,{style:a.text,children:r.warranty})}),t.limitationOfLiability&&e.jsx(f,{style:o.badge,children:e.jsx(x,{style:a.text,children:r.liabilityLimit})}),t.nonSolicitation&&e.jsx(f,{style:o.badge,children:e.jsx(x,{style:a.text,children:r.nonSolicitation})})]}),e.jsxs(f,{style:o.sectionContent,children:[e.jsxs(f,{style:o.infoRow,children:[e.jsxs(x,{style:[o.infoLabel,a.text],children:[r.disputeResolution,":"]}),e.jsx(x,{style:[o.infoValue,a.text],children:zt(t.disputePath,r)})]}),t.governingLaw&&e.jsxs(f,{style:o.infoRow,children:[e.jsxs(x,{style:[o.infoLabel,a.text],children:[r.governingLaw,":"]}),e.jsx(x,{style:[o.infoValue,a.text],children:t.governingLaw})]})]})]}),S.length>0&&e.jsx(f,{wrap:!1,children:e.jsx(f,{style:o.legalClausesHeader,children:e.jsx(x,{style:[o.legalClausesTitle,a.text],children:r.legalTerms})})}),S.map(h=>e.jsxs(f,{style:o.legalSection,children:[e.jsx(x,{style:[o.legalSectionTitle,a.text],children:h.title}),h.subsections.map(m=>e.jsxs(f,{style:o.legalSubsection,children:[m.title&&e.jsx(x,{style:[o.legalSubsectionTitle,a.text],children:m.title}),e.jsx(x,{style:[o.legalSubsectionContent,a.text],children:m.content})]},m.id))]},h.id)),e.jsxs(f,{style:[o.signatureSection,a.row],children:[e.jsxs(f,{style:o.signatureBox,children:[e.jsx(f,{style:o.signatureLine}),e.jsx(x,{style:[o.signatureLabel,a.text],children:r.provider})]}),e.jsxs(f,{style:o.signatureBox,children:[e.jsx(f,{style:o.signatureLine}),e.jsx(x,{style:[o.signatureLabel,a.text],children:r.client})]})]}),e.jsx(f,{style:o.footer,children:e.jsx(x,{style:a.text,children:r.generatedBy})})]})})}function Lt(t,n){return{on_signing:n.onSigning,on_milestone:n.onMilestone,on_completion:n.onCompletion,monthly:n.monthly}[t]||t}function zt(t,n){const i={negotiation:n.negotiation,mediation:n.mediation,arbitration:n.arbitration};return t?i[t]||t:"-"}async function _e(t){const{snapshot:n,client:i,language:s,type:c,category:l,profile:r,filename:d}=t;try{const u=I.createElement(At,{snapshot:n,client:i,language:s,type:c,category:l,profile:r}),p=await rt(u).toBlob(),N=(i?.name||n.clientName||"draft").replace(/[^a-zA-Z0-9-_]/g,"-"),S=new Date().toISOString().slice(0,10),v=`engagement-${N}-${S}.pdf`,b=URL.createObjectURL(p),k=document.createElement("a");return k.href=b,k.download=d||v,document.body.appendChild(k),k.click(),document.body.removeChild(k),URL.revokeObjectURL(b),{success:!0}}catch(u){const p=u instanceof Error?u.message:"Unknown error generating PDF";return console.error("Failed to generate engagement PDF:",u),{success:!1,error:p}}}function nn(){const t=be(),{language:n}=ze(),i=Me(n),s=ye(),[c,l]=I.useState("all"),[r,d]=I.useState(void 0),[u,p]=I.useState(void 0),[a,N]=I.useState(void 0),[S,v]=I.useState(void 0),[b,k]=I.useState(""),[E,A]=I.useState(void 0),L=I.useMemo(()=>{const j={search:b||void 0,profileId:a,clientId:S,type:r,category:u,includeArchived:c==="archived"};return c==="draft"?j.status="draft":c==="final"?j.status="final":c==="archived"&&(j.status="archived"),j},[c,r,u,a,S,b]),{data:h=[],isLoading:m}=dt(L),{data:w}=ut(),{data:D=[]}=ue(),{data:B=[]}=he(),{data:M}=pt(E||""),H=j=>{A(j)},V=()=>{s({to:"/engagements/new"})},Q=j=>{s({to:"/engagements/$engagementId/edit",params:{engagementId:j}})};return e.jsxs(e.Fragment,{children:[e.jsx(Fe,{title:t("engagements.title"),rightSlot:e.jsx("div",{className:"topbar-actions",children:e.jsxs("button",{className:"btn btn-primary",onClick:V,children:["+ ",t("engagements.new")]})})}),e.jsxs("div",{className:"engagements-layout",children:[e.jsxs("aside",{className:"engagements-filter-panel",children:[e.jsxs("div",{className:"filter-section",children:[e.jsx("h4",{className:"filter-section-title",children:t("engagements.filters.view")}),e.jsx("div",{className:"filter-radio-group",children:["all","draft","final","archived"].map(j=>e.jsxs("label",{className:C("filter-radio",c===j&&"active"),children:[e.jsx("input",{type:"radio",name:"view",checked:c===j,onChange:()=>l(j)}),e.jsx("span",{children:t(`engagements.filters.${j}`)}),w&&j!=="all"&&e.jsx("span",{className:"filter-count",children:w[j]})]},j))})]}),e.jsxs("div",{className:"filter-section",children:[e.jsx("h4",{className:"filter-section-title",children:t("engagements.filters.type")}),e.jsxs("select",{className:"select filter-select",value:r||"",onChange:j=>d(j.target.value||void 0),children:[e.jsx("option",{value:"",children:t("common.all")}),e.jsx("option",{value:"task",children:t("engagements.type.task")}),e.jsx("option",{value:"retainer",children:t("engagements.type.retainer")})]})]}),e.jsxs("div",{className:"filter-section",children:[e.jsx("h4",{className:"filter-section-title",children:t("engagements.filters.category")}),e.jsxs("select",{className:"select filter-select",value:u||"",onChange:j=>p(j.target.value||void 0),children:[e.jsx("option",{value:"",children:t("common.all")}),e.jsx("option",{value:"design",children:t("engagements.category.design")}),e.jsx("option",{value:"development",children:t("engagements.category.development")}),e.jsx("option",{value:"consulting",children:t("engagements.category.consulting")}),e.jsx("option",{value:"marketing",children:t("engagements.category.marketing")}),e.jsx("option",{value:"legal",children:t("engagements.category.legal")}),e.jsx("option",{value:"other",children:t("engagements.category.other")})]})]}),e.jsxs("div",{className:"filter-section",children:[e.jsx("h4",{className:"filter-section-title",children:t("engagements.filters.profile")}),e.jsxs("select",{className:"select filter-select",value:a||"",onChange:j=>N(j.target.value||void 0),children:[e.jsx("option",{value:"",children:t("common.all")}),D.map(j=>e.jsx("option",{value:j.id,children:j.name},j.id))]})]}),e.jsxs("div",{className:"filter-section",children:[e.jsx("h4",{className:"filter-section-title",children:t("engagements.filters.client")}),e.jsxs("select",{className:"select filter-select",value:S||"",onChange:j=>v(j.target.value||void 0),children:[e.jsx("option",{value:"",children:t("common.all")}),B.map(j=>e.jsx("option",{value:j.id,children:j.name},j.id))]})]}),e.jsx("div",{className:"filter-section",children:e.jsx(Xe,{value:b,onChange:k,placeholder:t("engagements.searchPlaceholder")})}),w&&e.jsxs("div",{className:"filter-section engagements-summary",children:[e.jsx("h4",{className:"filter-section-title",children:t("engagements.summary")}),e.jsxs("div",{className:"engagements-summary-stat",children:[e.jsx("span",{className:"engagements-summary-label",children:t("engagements.draftCount")}),e.jsx("span",{className:"engagements-summary-value",children:w.draft})]}),e.jsxs("div",{className:"engagements-summary-stat",children:[e.jsx("span",{className:"engagements-summary-label",children:t("engagements.finalCount")}),e.jsx("span",{className:"engagements-summary-value",children:w.final})]}),e.jsxs("div",{className:"engagements-summary-stat",children:[e.jsx("span",{className:"engagements-summary-label",children:t("engagements.archivedCount")}),e.jsx("span",{className:"engagements-summary-value",children:w.archived})]})]})]}),e.jsx("main",{className:"engagements-main",children:m?e.jsx("div",{className:"loading",children:e.jsx("div",{className:"spinner"})}):h.length===0?e.jsx(it,{title:t("engagements.empty"),description:t(b?"engagements.emptySearch":"engagements.emptyHint"),action:b?void 0:{label:t("engagements.addEngagement"),onClick:V}}):e.jsx("div",{className:"table-container",children:e.jsxs("table",{className:"data-table",children:[e.jsx("thead",{children:e.jsxs("tr",{children:[e.jsx("th",{children:t("engagements.columns.status")}),e.jsx("th",{children:t("engagements.columns.title")}),e.jsx("th",{children:t("engagements.columns.client")}),e.jsx("th",{children:t("engagements.columns.type")}),e.jsx("th",{children:t("engagements.columns.category")}),e.jsx("th",{children:t("engagements.columns.language")}),e.jsx("th",{children:t("engagements.columns.versions")}),e.jsx("th",{children:t("engagements.columns.updated")})]})}),e.jsx("tbody",{children:h.map(j=>e.jsxs("tr",{className:C("clickable",E===j.id&&"selected"),onClick:()=>H(j.id),children:[e.jsx("td",{children:e.jsx(Ve,{status:j.status})}),e.jsx("td",{className:"cell-primary",children:j.title||t("engagements.untitled")}),e.jsx("td",{children:j.clientName||"-"}),e.jsx("td",{children:e.jsx("span",{className:"type-badge",children:t(`engagements.type.${j.type}`)})}),e.jsx("td",{children:e.jsx("span",{className:"category-badge",children:t(`engagements.category.${j.category}`)})}),e.jsx("td",{children:e.jsx("span",{className:C("language-badge",`lang-${j.primaryLanguage}`),children:j.primaryLanguage==="ar"?"AR":"EN"})}),e.jsx("td",{className:"cell-center",children:j.versionCount||0}),e.jsx("td",{children:j.updatedAt?new Date(j.updatedAt).toLocaleDateString(i,{month:"short",day:"numeric",year:"numeric"}):"-"})]},j.id))})]})})}),e.jsx("aside",{className:C("engagements-inspector",E&&"visible"),children:M?e.jsx(Ft,{engagement:M,onClose:()=>A(void 0),onEdit:()=>Q(M.id)}):e.jsx("div",{className:"inspector-placeholder",children:e.jsx("p",{children:t("engagements.selectToInspect")})})})]})]})}function Ve({status:t}){const n=be();return e.jsx("span",{className:C("status-badge",`status-${t}`),children:n(`engagements.status.${t}`)})}function Ft({engagement:t,onClose:n,onEdit:i}){const s=be(),{language:c}=ze(),l=Me(c),r=ye(),[d,u]=I.useState(!1),{showToast:p}=Oe(),a=gt(),N=xt(),S=vt(),{data:v}=Be(t.id),{data:b=[]}=he(),{data:k=[]}=ue(),E=()=>{confirm(s("engagements.confirmArchive"))&&a.mutate(t.id)},A=()=>{N.mutate(t.id)},L=()=>{S.mutate({id:t.id},{onSuccess:w=>{r({to:"/engagements/$engagementId/edit",params:{engagementId:w.id}})}})},h=async()=>{if(m){u(!0);try{const w=b.find(M=>M.id===t.clientId),D=k.find(M=>M.id===m.profileId),B=await _e({snapshot:m,client:w,language:t.primaryLanguage,type:t.type,category:t.category,profile:D});B.success?p("PDF downloaded"):(console.error("PDF generation failed:",B.error),p("Failed to download PDF. Please try again."))}catch(w){console.error("Failed to download PDF:",w),p("Failed to download PDF. Please try again.")}finally{u(!1)}}},m=v?.snapshot;return e.jsxs("div",{className:"inspector-content",children:[e.jsxs("div",{className:"inspector-header",children:[e.jsx("h3",{className:"inspector-title",children:t.title||s("engagements.untitled")}),e.jsx("button",{className:"btn-icon",onClick:n,"aria-label":s("common.close"),children:e.jsx(Mt,{})})]}),e.jsxs("div",{className:"inspector-section",children:[e.jsx("h4",{className:"inspector-section-title",children:s("engagements.inspector.overview")}),e.jsxs("dl",{className:"inspector-details",children:[e.jsxs("div",{className:"inspector-detail",children:[e.jsx("dt",{children:s("engagements.inspector.client")}),e.jsx("dd",{children:t.clientName||s("common.noClient")})]}),t.projectName&&e.jsxs("div",{className:"inspector-detail",children:[e.jsx("dt",{children:s("engagements.inspector.project")}),e.jsx("dd",{children:t.projectName})]}),e.jsxs("div",{className:"inspector-detail",children:[e.jsx("dt",{children:s("engagements.inspector.type")}),e.jsx("dd",{children:s(`engagements.type.${t.type}`)})]}),e.jsxs("div",{className:"inspector-detail",children:[e.jsx("dt",{children:s("engagements.inspector.category")}),e.jsx("dd",{children:s(`engagements.category.${t.category}`)})]}),e.jsxs("div",{className:"inspector-detail",children:[e.jsx("dt",{children:s("engagements.inspector.language")}),e.jsx("dd",{children:t.primaryLanguage==="ar"?"Arabic":"English"})]}),e.jsxs("div",{className:"inspector-detail",children:[e.jsx("dt",{children:s("engagements.inspector.status")}),e.jsx("dd",{children:e.jsx(Ve,{status:t.status})})]}),e.jsxs("div",{className:"inspector-detail",children:[e.jsx("dt",{children:s("engagements.inspector.versions")}),e.jsx("dd",{children:t.versionCount||0})]}),e.jsxs("div",{className:"inspector-detail",children:[e.jsx("dt",{children:s("engagements.inspector.created")}),e.jsx("dd",{children:new Date(t.createdAt).toLocaleDateString(l)})]}),t.lastVersionAt&&e.jsxs("div",{className:"inspector-detail",children:[e.jsx("dt",{children:s("engagements.inspector.lastUpdated")}),e.jsx("dd",{children:new Date(t.lastVersionAt).toLocaleDateString(l)})]})]})]}),m?.summary&&e.jsxs("div",{className:"inspector-section",children:[e.jsx("h4",{className:"inspector-section-title",children:s("engagements.inspector.summary")}),e.jsx("p",{className:"inspector-summary",children:m.summary})]}),m&&e.jsxs("div",{className:"inspector-section",children:[e.jsx("h4",{className:"inspector-section-title",children:s("engagements.inspector.scope")}),e.jsxs("dl",{className:"inspector-details",children:[e.jsxs("div",{className:"inspector-detail",children:[e.jsx("dt",{children:s("engagements.inspector.deliverables")}),e.jsx("dd",{children:m.deliverables?.length||0})]}),e.jsxs("div",{className:"inspector-detail",children:[e.jsx("dt",{children:s("engagements.inspector.exclusions")}),e.jsx("dd",{children:m.exclusions?.length||0})]}),e.jsxs("div",{className:"inspector-detail",children:[e.jsx("dt",{children:s("engagements.inspector.milestones")}),e.jsx("dd",{children:m.milestones?.length||0})]})]})]}),e.jsxs("div",{className:"inspector-actions",children:[t.status!=="archived"&&e.jsx("button",{className:"btn btn-primary",onClick:i,children:t.status==="final"?s("common.view"):s("common.edit")}),t.status==="final"&&m&&e.jsx("button",{className:"btn btn-secondary",onClick:h,disabled:d,children:s(d?"common.downloading":"engagements.downloadPdf")}),e.jsx("button",{className:"btn btn-secondary",onClick:L,disabled:S.isPending,children:s("engagements.duplicate")}),t.status==="archived"?e.jsx("button",{className:"btn btn-secondary",onClick:A,disabled:N.isPending,children:s("engagements.restore")}):e.jsx("button",{className:"btn btn-danger",onClick:E,disabled:a.isPending,children:s("engagements.archive")})]})]})}function Mt(){return e.jsx("svg",{width:"20",height:"20",fill:"none",viewBox:"0 0 24 24",stroke:"currentColor",strokeWidth:1.5,children:e.jsx("path",{strokeLinecap:"round",strokeLinejoin:"round",d:"M6 18 18 6M6 6l12 12"})})}const re=9,oe=["Client Setup","Summary","Scope","Timeline","Reviews","Payment","Relationship","Terms","Review & Export"],Te={currentStep:0,mode:"create",engagementId:void 0,engagementType:"task",engagementCategory:"design",primaryLanguage:"en",isDirty:!1,lastSavedAt:void 0,isLoading:!1,isSaving:!1,prefillProfileId:void 0,prefillClientId:void 0,prefillProjectId:void 0,visitedSteps:new Set([0])},q=Je((t,n)=>({...Te,setStep:i=>{const s=n();s.canNavigateToStep(i)&&t({currentStep:i,visitedSteps:new Set([...s.visitedSteps,i])})},nextStep:()=>{const{currentStep:i}=n(),s=Math.min(i+1,re-1);n().setStep(s)},prevStep:()=>{const{currentStep:i}=n(),s=Math.max(i-1,0);t({currentStep:s})},setEngagementId:i=>t({engagementId:i}),setEngagementType:i=>t({engagementType:i}),setEngagementCategory:i=>t({engagementCategory:i}),setPrimaryLanguage:i=>t({primaryLanguage:i}),setDirty:i=>t({isDirty:i}),setLastSavedAt:i=>t({lastSavedAt:i}),setIsLoading:i=>t({isLoading:i}),setIsSaving:i=>t({isSaving:i}),setPrefill:i=>t({prefillProfileId:i.profileId,prefillClientId:i.clientId,prefillProjectId:i.projectId,engagementType:i.type||"task"}),markStepVisited:i=>t(s=>({visitedSteps:new Set([...s.visitedSteps,i])})),canNavigateToStep:i=>{const{visitedSteps:s,currentStep:c}=n();return s.has(i)?!0:i===c+1},reset:()=>t({...Te,visitedSteps:new Set([0])}),initializeForEdit:i=>t({mode:"edit",engagementId:i.engagementId,engagementType:i.type,engagementCategory:i.category,primaryLanguage:i.language,currentStep:0,visitedSteps:new Set([0,1,2,3,4,5,6,7,8])})})),Se="engagement_wizard_autosave",Ot=2e3;function Bt(t,n,i,s){const c=I.useRef(),l=I.useRef(n);l.current=n;const r=I.useCallback(()=>{const d={engagementId:t,snapshot:l.current,savedAt:new Date().toISOString()};localStorage.setItem(Se,JSON.stringify(d)),s?.(d.savedAt)},[t,s]);return I.useEffect(()=>{if(i)return c.current&&clearTimeout(c.current),c.current=setTimeout(r,Ot),()=>{c.current&&clearTimeout(c.current)}},[n,i,r]),I.useEffect(()=>()=>{c.current&&(clearTimeout(c.current),i&&r())},[i,r]),{saveNow:r}}function Ue(){try{const t=localStorage.getItem(Se);return t?JSON.parse(t):null}catch{return null}}function Pe(){localStorage.removeItem(Se)}function _t(){const t=Ue();if(!t)return!1;const n=new Date(t.savedAt),i=new Date(Date.now()-3600*1e3);return n>i}const Vt=[{id:"no_deposit",severity:"high",stepIndex:5,fieldPath:"depositPercent",messageKey:"clarityCheck.noDeposit",check:(t,n)=>n==="task"&&(t.depositPercent===void 0||t.depositPercent===0)},{id:"no_exclusions",severity:"high",stepIndex:2,fieldPath:"exclusions",messageKey:"clarityCheck.noExclusions",check:t=>!t.exclusions||t.exclusions.length===0},{id:"no_review_window",severity:"high",stepIndex:3,fieldPath:"reviewWindowDays",messageKey:"clarityCheck.noReviewWindow",check:t=>t.reviewWindowDays===void 0||t.reviewWindowDays===0},{id:"no_capacity_cap",severity:"high",stepIndex:4,fieldPath:"monthlyCapacity",messageKey:"clarityCheck.noCapacityCap",check:(t,n)=>n==="retainer"&&!t.monthlyCapacity&&(!t.outOfScopeRateMinor||t.outOfScopeRateMinor===0)},{id:"no_termination_notice",severity:"medium",stepIndex:6,fieldPath:"terminationNoticeDays",messageKey:"clarityCheck.noTerminationNotice",check:t=>t.terminationNoticeDays===void 0||t.terminationNoticeDays===0},{id:"no_bug_fix_window",severity:"medium",stepIndex:4,fieldPath:"bugFixDays",messageKey:"clarityCheck.noBugFixWindow",check:(t,n,i)=>i==="development"&&(t.bugFixDays===void 0||t.bugFixDays===0)},{id:"no_revision_limit",severity:"medium",stepIndex:4,fieldPath:"revisionRounds",messageKey:"clarityCheck.noRevisionLimit",check:(t,n,i)=>i==="design"&&(t.revisionRounds===void 0||t.revisionRounds===0)},{id:"no_dependencies",severity:"medium",stepIndex:2,fieldPath:"dependencies",messageKey:"clarityCheck.noDependencies",check:t=>!t.dependencies||t.dependencies.length===0},{id:"no_deliverables",severity:"medium",stepIndex:2,fieldPath:"deliverables",messageKey:"clarityCheck.noDeliverables",check:t=>!t.deliverables||t.deliverables.length===0},{id:"no_milestones",severity:"medium",stepIndex:3,fieldPath:"milestones",messageKey:"clarityCheck.noMilestones",check:(t,n)=>n==="task"&&(!t.milestones||t.milestones.length===0)},{id:"late_fee_off",severity:"low",stepIndex:5,fieldPath:"lateFeeEnabled",messageKey:"clarityCheck.lateFeeOff",check:t=>t.lateFeeEnabled===!1},{id:"no_dispute_path",severity:"low",stepIndex:7,fieldPath:"disputePath",messageKey:"clarityCheck.noDisputePath",check:t=>!t.disputePath},{id:"no_governing_law",severity:"low",stepIndex:7,fieldPath:"governingLaw",messageKey:"clarityCheck.noGoverningLaw",check:t=>!t.governingLaw},{id:"no_ownership_rule",severity:"low",stepIndex:6,fieldPath:"ownershipTransferRule",messageKey:"clarityCheck.noOwnershipRule",check:t=>!t.ownershipTransferRule},{id:"no_summary",severity:"low",stepIndex:1,fieldPath:"summary",messageKey:"clarityCheck.noSummary",check:t=>!t.summary||t.summary.trim().length===0}];function Ut(t,n,i){return I.useMemo(()=>{const s=[];for(const l of Vt)l.check(t,n,i)&&s.push({id:l.id,severity:l.severity,stepIndex:l.stepIndex,fieldPath:l.fieldPath,messageKey:l.messageKey});const c={high:0,medium:1,low:2};return s.sort((l,r)=>c[l.severity]-c[r.severity]),s},[t,n,i])}function Wt(t,n){return t.filter(i=>i.stepIndex===n)}function We(t){return{high:t.filter(n=>n.severity==="high").length,medium:t.filter(n=>n.severity==="medium").length,low:t.filter(n=>n.severity==="low").length,total:t.length}}function Gt(t){return t.some(n=>n.severity==="high")}const qt={"clarityCheck.noDeposit":{en:"No deposit required - Consider requesting upfront payment to protect your work",ar:"لا يوجد دفعة مقدمة - فكر في طلب دفعة مقدمة لحماية عملك"},"clarityCheck.noExclusions":{en:"No exclusions defined - Clearly state what is NOT included to avoid scope creep",ar:"لم يتم تحديد استثناءات - حدد بوضوح ما هو غير مشمول لتجنب توسع النطاق"},"clarityCheck.noReviewWindow":{en:"No review window set - Define how long the client has to review deliverables",ar:"لم يتم تحديد فترة المراجعة - حدد المدة المتاحة للعميل لمراجعة التسليمات"},"clarityCheck.noCapacityCap":{en:"No capacity cap for retainer - Set monthly limits or out-of-scope rates",ar:"لا يوجد حد للقدرة في الاشتراك - حدد الحدود الشهرية أو أسعار العمل خارج النطاق"},"clarityCheck.noTerminationNotice":{en:"No termination notice period - Define how much notice is required to end the agreement",ar:"لا يوجد فترة إشعار للإنهاء - حدد مدة الإشعار المطلوبة لإنهاء الاتفاقية"},"clarityCheck.noBugFixWindow":{en:"No bug fix window defined - For development work, specify how long you will fix bugs after delivery",ar:"لم يتم تحديد فترة إصلاح الأخطاء - لأعمال التطوير، حدد مدة إصلاح الأخطاء بعد التسليم"},"clarityCheck.noRevisionLimit":{en:"No revision limit set - For design work, specify how many revision rounds are included",ar:"لم يتم تحديد حد للمراجعات - لأعمال التصميم، حدد عدد جولات المراجعة المشمولة"},"clarityCheck.noDependencies":{en:"No dependencies listed - Document what you need from the client to proceed",ar:"لم يتم تحديد متطلبات - وثق ما تحتاجه من العميل للمتابعة"},"clarityCheck.noDeliverables":{en:"No deliverables defined - List specific outputs the client will receive",ar:"لم يتم تحديد التسليمات - حدد المخرجات التي سيستلمها العميل"},"clarityCheck.noMilestones":{en:"No milestones set - Breaking work into milestones helps track progress",ar:"لم يتم تحديد معالم - تقسيم العمل إلى معالم يساعد في تتبع التقدم"},"clarityCheck.lateFeeOff":{en:"Late payment fee disabled - Consider enabling to encourage timely payments",ar:"رسوم التأخير معطلة - فكر في تفعيلها لتشجيع الدفع في الوقت المحدد"},"clarityCheck.noDisputePath":{en:"No dispute resolution path - Define how disagreements will be resolved",ar:"لم يتم تحديد مسار حل النزاعات - حدد كيفية حل الخلافات"},"clarityCheck.noGoverningLaw":{en:"No governing law specified - Consider stating which jurisdiction applies",ar:"لم يتم تحديد القانون المعمول به - فكر في تحديد الاختصاص القضائي المطبق"},"clarityCheck.noOwnershipRule":{en:"No ownership transfer rule - Define when work ownership transfers to the client",ar:"لم يتم تحديد قاعدة نقل الملكية - حدد متى تنتقل ملكية العمل للعميل"},"clarityCheck.noSummary":{en:"No project summary - A brief description helps set expectations",ar:"لا يوجد ملخص للمشروع - وصف موجز يساعد في تحديد التوقعات"}},Re={profileId:"",profileName:"",clientId:"",clientName:"",title:"",summary:"",deliverables:[],exclusions:[],dependencies:[],milestones:[],reviewWindowDays:3,silenceEqualsApproval:!1,revisionRounds:2,revisionDefinition:[],changeRequestRule:!0,currency:"USD",scheduleItems:[],lateFeeEnabled:!1,termType:"fixed",terminationNoticeDays:14,ownershipTransferRule:"upon_full_payment",confidentiality:!0,ipOwnership:!0,warrantyDisclaimer:!0,limitationOfLiability:!0,nonSolicitation:!1,disputePath:"negotiation"};function Ht({risks:t=[],className:n}){const{currentStep:i,setStep:s,visitedSteps:c,canNavigateToStep:l}=q();return e.jsxs("div",{className:C("wizard-progress",n),children:[e.jsx("div",{className:"wizard-progress-track",children:Array.from({length:re},(r,d)=>{const u=d,p=i===u,a=c.has(u)&&i>u,N=l(u)||c.has(u),S=Wt(t,u),v=S.some(k=>k.severity==="high"),b=S.some(k=>k.severity==="medium");return e.jsxs("div",{className:"wizard-step-container",children:[d>0&&e.jsx("div",{className:C("wizard-connector",(a||p)&&"wizard-connector-active")}),e.jsxs("button",{type:"button",className:C("wizard-step",p&&"wizard-step-active",a&&"wizard-step-completed",!N&&"wizard-step-disabled",v&&"wizard-step-risk-high",b&&!v&&"wizard-step-risk-medium"),onClick:()=>N&&s(u),disabled:!N,title:oe[u],children:[a?e.jsx("svg",{className:"wizard-step-check",viewBox:"0 0 20 20",fill:"currentColor",width:"14",height:"14",children:e.jsx("path",{fillRule:"evenodd",d:"M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z",clipRule:"evenodd"})}):e.jsx("span",{className:"wizard-step-number",children:d+1}),S.length>0&&e.jsx("span",{className:C("wizard-step-risk-dot",v&&"risk-high",b&&!v&&"risk-medium")})]}),e.jsx("span",{className:C("wizard-step-label",p&&"wizard-step-label-active"),children:oe[u]})]},u)})}),e.jsxs("div",{className:"wizard-progress-bar-mobile",children:[e.jsx("div",{className:"wizard-progress-bar-fill",style:{width:`${(i+1)/re*100}%`}}),e.jsxs("span",{className:"wizard-progress-text",children:["Step ",i+1," of ",re,": ",oe[i]]})]}),e.jsx("style",{children:`
        .wizard-progress {
          padding: 16px 0;
          margin-bottom: 24px;
        }

        .wizard-progress-track {
          display: none;
          align-items: flex-start;
          justify-content: space-between;
          position: relative;
        }

        @media (min-width: 900px) {
          .wizard-progress-track {
            display: flex;
          }
          .wizard-progress-bar-mobile {
            display: none;
          }
        }

        .wizard-step-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          flex: 1;
          position: relative;
        }

        .wizard-connector {
          position: absolute;
          top: 16px;
          left: -50%;
          right: 50%;
          height: 2px;
          background: var(--border);
          z-index: 0;
        }

        .wizard-connector-active {
          background: var(--primary);
        }

        .wizard-step {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          border: 2px solid var(--border);
          background: var(--bg);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s ease;
          position: relative;
          z-index: 1;
        }

        .wizard-step:hover:not(:disabled) {
          border-color: var(--primary);
        }

        .wizard-step-active {
          border-color: var(--primary);
          background: var(--primary);
          color: white;
        }

        .wizard-step-completed {
          border-color: var(--primary);
          background: var(--primary);
          color: white;
        }

        .wizard-step-disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .wizard-step-risk-high {
          border-color: var(--danger);
        }

        .wizard-step-risk-medium {
          border-color: var(--warning);
        }

        .wizard-step-number {
          font-size: 12px;
          font-weight: 600;
        }

        .wizard-step-check {
          color: white;
        }

        .wizard-step-risk-dot {
          position: absolute;
          top: -2px;
          right: -2px;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--warning);
          border: 1px solid var(--bg);
        }

        .wizard-step-risk-dot.risk-high {
          background: var(--danger);
        }

        .wizard-step-risk-dot.risk-medium {
          background: var(--warning);
        }

        .wizard-step-label {
          margin-top: 8px;
          font-size: 11px;
          color: var(--text-muted);
          text-align: center;
          max-width: 70px;
          line-height: 1.2;
        }

        .wizard-step-label-active {
          color: var(--text);
          font-weight: 500;
        }

        .wizard-progress-bar-mobile {
          position: relative;
          height: 4px;
          background: var(--border);
          border-radius: 2px;
          overflow: hidden;
        }

        .wizard-progress-bar-fill {
          height: 100%;
          background: var(--primary);
          transition: width 0.3s ease;
        }

        .wizard-progress-text {
          display: block;
          margin-top: 8px;
          font-size: 13px;
          color: var(--text-muted);
          text-align: center;
        }
      `})]})}function Qt({onSaveDraft:t,onFinalize:n,isSaving:i=!1,isValid:s=!0,className:c}){const{currentStep:l,nextStep:r,prevStep:d,lastSavedAt:u,isDirty:p}=q(),a=l===0,N=l===re-1,S=()=>u?`Last saved: ${new Date(u).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}`:null;return e.jsxs("div",{className:C("wizard-navigation",c),children:[e.jsxs("div",{className:"wizard-nav-left",children:[e.jsx("button",{type:"button",className:"btn btn-ghost",onClick:d,disabled:a||i,children:"← Previous"}),e.jsx("div",{className:"wizard-nav-status",children:i?e.jsx("span",{className:"text-muted",children:"Saving..."}):u?e.jsx("span",{className:"text-muted",children:S()}):p?e.jsx("span",{className:"text-muted",children:"Unsaved changes"}):null})]}),e.jsxs("div",{className:"wizard-nav-right",children:[e.jsx("button",{type:"button",className:"btn btn-secondary",onClick:t,disabled:i,children:i?"Saving...":"Save Draft"}),N?e.jsx("button",{type:"button",className:"btn btn-primary",onClick:n,disabled:i||!s,children:"Finalize & Export"}):e.jsx("button",{type:"button",className:"btn btn-primary",onClick:r,disabled:i,children:"Next →"})]}),e.jsx("style",{children:`
        .wizard-navigation {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 0;
          border-top: 1px solid var(--border);
          margin-top: 24px;
          gap: 16px;
        }

        .wizard-nav-left {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .wizard-nav-right {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .wizard-nav-status {
          font-size: 12px;
        }

        @media (max-width: 600px) {
          .wizard-navigation {
            flex-wrap: wrap;
          }

          .wizard-nav-left {
            order: 2;
            width: 100%;
            justify-content: space-between;
            margin-top: 12px;
          }

          .wizard-nav-right {
            order: 1;
            width: 100%;
            justify-content: flex-end;
          }
        }
      `})]})}function Ge({risks:t,className:n}){const[i,s]=I.useState(!0),{setStep:c}=q(),l=We(t),r=a=>{c(a.stepIndex)},d=a=>{switch(a){case"high":return"var(--danger)";case"medium":return"var(--warning)";case"low":return"var(--text-muted)"}},u=a=>{switch(a){case"high":return"High";case"medium":return"Medium";case"low":return"Low"}},p=a=>qt[a]?.en||a;return t.length===0?e.jsxs("div",{className:C("clarity-check-panel clarity-check-success",n),children:[e.jsxs("div",{className:"clarity-check-header",children:[e.jsx("svg",{viewBox:"0 0 20 20",fill:"currentColor",width:"20",height:"20",className:"clarity-check-icon-success",children:e.jsx("path",{fillRule:"evenodd",d:"M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z",clipRule:"evenodd"})}),e.jsx("span",{children:"Clarity Check"})]}),e.jsx("p",{className:"clarity-check-success-message",children:"Looking good! No issues found."}),e.jsx("style",{children:Ae})]}):e.jsxs("div",{className:C("clarity-check-panel",n),children:[e.jsxs("button",{type:"button",className:"clarity-check-header",onClick:()=>s(!i),children:[e.jsxs("div",{className:"clarity-check-header-left",children:[e.jsx("svg",{viewBox:"0 0 20 20",fill:"currentColor",width:"20",height:"20",className:"clarity-check-icon-warning",children:e.jsx("path",{fillRule:"evenodd",d:"M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z",clipRule:"evenodd"})}),e.jsx("span",{children:"Clarity Check"}),e.jsxs("span",{className:"clarity-check-count",children:[l.total," ",l.total===1?"issue":"issues"]})]}),e.jsx("svg",{viewBox:"0 0 20 20",fill:"currentColor",width:"16",height:"16",className:C("clarity-check-chevron",i&&"expanded"),children:e.jsx("path",{fillRule:"evenodd",d:"M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z",clipRule:"evenodd"})})]}),i&&e.jsxs(e.Fragment,{children:[e.jsxs("div",{className:"clarity-check-summary",children:[l.high>0&&e.jsxs("span",{className:"clarity-badge clarity-badge-high",children:[l.high," high"]}),l.medium>0&&e.jsxs("span",{className:"clarity-badge clarity-badge-medium",children:[l.medium," medium"]}),l.low>0&&e.jsxs("span",{className:"clarity-badge clarity-badge-low",children:[l.low," low"]})]}),e.jsx("div",{className:"clarity-check-list",children:t.map(a=>e.jsxs("button",{type:"button",className:"clarity-check-item",onClick:()=>r(a),children:[e.jsx("div",{className:"clarity-check-dot",style:{background:d(a.severity)}}),e.jsxs("div",{className:"clarity-check-item-content",children:[e.jsxs("div",{className:"clarity-check-item-header",children:[e.jsxs("span",{className:"clarity-check-item-step",children:["Step ",a.stepIndex+1,": ",oe[a.stepIndex]]}),e.jsx("span",{className:"clarity-check-item-severity",style:{color:d(a.severity)},children:u(a.severity)})]}),e.jsx("p",{className:"clarity-check-item-message",children:p(a.messageKey)})]})]},a.id))})]}),e.jsx("style",{children:Ae})]})}const Ae=`
  .clarity-check-panel {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
  }

  .clarity-check-success {
    border-color: var(--success-border, var(--border));
  }

  .clarity-check-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background: transparent;
    border: none;
    width: 100%;
    cursor: pointer;
    text-align: left;
  }

  .clarity-check-header-left {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 500;
    font-size: 14px;
  }

  .clarity-check-icon-warning {
    color: var(--warning);
  }

  .clarity-check-icon-success {
    color: var(--success, #10b981);
  }

  .clarity-check-count {
    font-weight: normal;
    color: var(--text-muted);
    font-size: 13px;
  }

  .clarity-check-chevron {
    color: var(--text-muted);
    transition: transform 0.2s ease;
  }

  .clarity-check-chevron.expanded {
    transform: rotate(180deg);
  }

  .clarity-check-summary {
    display: flex;
    gap: 8px;
    padding: 0 16px 12px;
    flex-wrap: wrap;
  }

  .clarity-badge {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 4px;
    font-weight: 500;
  }

  .clarity-badge-high {
    background: rgba(239, 68, 68, 0.1);
    color: var(--danger);
  }

  .clarity-badge-medium {
    background: rgba(245, 158, 11, 0.1);
    color: var(--warning);
  }

  .clarity-badge-low {
    background: rgba(107, 114, 128, 0.1);
    color: var(--text-muted);
  }

  .clarity-check-list {
    border-top: 1px solid var(--border);
  }

  .clarity-check-item {
    display: flex;
    gap: 12px;
    padding: 12px 16px;
    border: none;
    background: transparent;
    width: 100%;
    text-align: left;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .clarity-check-item:hover {
    background: var(--bg-hover);
  }

  .clarity-check-item + .clarity-check-item {
    border-top: 1px solid var(--border);
  }

  .clarity-check-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    margin-top: 6px;
  }

  .clarity-check-item-content {
    flex: 1;
    min-width: 0;
  }

  .clarity-check-item-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
  }

  .clarity-check-item-step {
    font-size: 11px;
    color: var(--text-muted);
  }

  .clarity-check-item-severity {
    font-size: 11px;
    font-weight: 500;
  }

  .clarity-check-item-message {
    font-size: 13px;
    color: var(--text);
    margin: 0;
    line-height: 1.4;
  }

  .clarity-check-success-message {
    padding: 0 16px 16px;
    margin: 0;
    font-size: 13px;
    color: var(--success, #10b981);
  }
`;function Kt({snapshot:t,client:n,project:i,language:s,className:c}){const l=s==="ar",r=(d,u)=>{if(d===void 0)return"—";const p=d/100;return new Intl.NumberFormat(s==="ar"?"ar-SA":"en-US",{style:"currency",currency:u||"USD"}).format(p)};return e.jsxs("div",{className:C("engagement-preview",l&&"rtl",c),children:[e.jsxs("div",{className:"preview-document",children:[e.jsxs("div",{className:"preview-header",children:[e.jsx("h1",{className:"preview-title",children:t.title||(s==="ar"?"اتفاقية عمل":"Engagement Agreement")}),n&&e.jsxs("p",{className:"preview-client",children:[s==="ar"?"العميل: ":"Client: ",n.name]}),i&&e.jsxs("p",{className:"preview-project",children:[s==="ar"?"المشروع: ":"Project: ",i.name]})]}),t.summary&&e.jsxs("div",{className:"preview-section",children:[e.jsx("h2",{children:s==="ar"?"نظرة عامة":"Overview"}),e.jsx("p",{children:t.summary}),t.clientGoal&&e.jsxs("p",{className:"preview-goal",children:[e.jsx("strong",{children:s==="ar"?"الهدف: ":"Goal: "}),t.clientGoal]})]}),t.deliverables&&t.deliverables.length>0&&e.jsxs("div",{className:"preview-section",children:[e.jsx("h2",{children:s==="ar"?"التسليمات":"Deliverables"}),e.jsx("ul",{children:t.deliverables.map((d,u)=>e.jsxs("li",{children:[d.description,d.quantity&&e.jsxs("span",{className:"preview-qty",children:[" (×",d.quantity,")"]}),d.format&&e.jsxs("span",{className:"preview-format",children:[" [",d.format,"]"]})]},d.id||u))})]}),t.exclusions&&t.exclusions.length>0&&e.jsxs("div",{className:"preview-section",children:[e.jsx("h2",{children:s==="ar"?"الاستثناءات":"Exclusions"}),e.jsx("ul",{className:"preview-exclusions",children:t.exclusions.map((d,u)=>e.jsx("li",{children:d},u))})]}),(t.startDate||t.milestones?.length)&&e.jsxs("div",{className:"preview-section",children:[e.jsx("h2",{children:s==="ar"?"الجدول الزمني":"Timeline"}),t.startDate&&e.jsxs("p",{children:[e.jsx("strong",{children:s==="ar"?"تاريخ البدء: ":"Start Date: "}),new Date(t.startDate).toLocaleDateString(s==="ar"?"ar-SA":"en-US")]}),t.endDate&&e.jsxs("p",{children:[e.jsx("strong",{children:s==="ar"?"تاريخ الانتهاء: ":"End Date: "}),new Date(t.endDate).toLocaleDateString(s==="ar"?"ar-SA":"en-US")]}),t.milestones&&t.milestones.length>0&&e.jsxs("div",{className:"preview-milestones",children:[e.jsx("h3",{children:s==="ar"?"المراحل":"Milestones"}),e.jsx("ul",{children:t.milestones.map((d,u)=>e.jsxs("li",{children:[d.title,d.targetDate&&e.jsxs("span",{className:"preview-date",children:[" ","— ",new Date(d.targetDate).toLocaleDateString(s==="ar"?"ar-SA":"en-US")]})]},d.id||u))})]})]}),e.jsxs("div",{className:"preview-section",children:[e.jsx("h2",{children:s==="ar"?"الدفع":"Payment"}),t.totalAmountMinor!==void 0&&e.jsxs("p",{className:"preview-total",children:[e.jsx("strong",{children:s==="ar"?"الإجمالي: ":"Total: "}),r(t.totalAmountMinor,t.currency)]}),t.depositPercent!==void 0&&t.depositPercent>0&&e.jsxs("p",{children:[e.jsx("strong",{children:s==="ar"?"الدفعة المقدمة: ":"Deposit: "}),t.depositPercent,"%"]}),t.scheduleItems&&t.scheduleItems.length>0&&e.jsxs("div",{className:"preview-schedule",children:[e.jsx("h3",{children:s==="ar"?"جدول الدفع":"Payment Schedule"}),e.jsx("ul",{children:t.scheduleItems.map((d,u)=>e.jsxs("li",{children:[d.label,": ",r(d.amountMinor,d.currency)]},d.id||u))})]})]}),e.jsxs("div",{className:"preview-section",children:[e.jsx("h2",{children:s==="ar"?"الشروط":"Terms"}),e.jsxs("div",{className:"preview-terms-grid",children:[t.confidentiality&&e.jsx("span",{className:"preview-term-badge",children:s==="ar"?"سرية":"Confidentiality"}),t.ipOwnership&&e.jsx("span",{className:"preview-term-badge",children:s==="ar"?"ملكية فكرية":"IP Ownership"}),t.warrantyDisclaimer&&e.jsx("span",{className:"preview-term-badge",children:s==="ar"?"إخلاء ضمان":"Warranty Disclaimer"}),t.limitationOfLiability&&e.jsx("span",{className:"preview-term-badge",children:s==="ar"?"حد المسؤولية":"Liability Limit"}),t.nonSolicitation&&e.jsx("span",{className:"preview-term-badge",children:s==="ar"?"عدم الاستقطاب":"Non-Solicitation"})]}),t.terminationNoticeDays!==void 0&&t.terminationNoticeDays>0&&e.jsxs("p",{children:[e.jsx("strong",{children:s==="ar"?"فترة الإشعار: ":"Notice Period: "}),t.terminationNoticeDays," ",s==="ar"?"يوم":"days"]})]}),e.jsx("div",{className:"preview-footer",children:e.jsx("p",{className:"preview-disclaimer",children:s==="ar"?"هذا مستند معاينة. المستند النهائي سيتضمن جميع التفاصيل القانونية.":"This is a preview document. The final document will include all legal details."})})]}),e.jsx("style",{children:`
        .engagement-preview {
          background: white;
          height: 100%;
          overflow-y: auto;
          font-family: Georgia, serif;
        }

        .engagement-preview.rtl {
          direction: rtl;
          text-align: right;
        }

        .preview-document {
          max-width: 600px;
          margin: 0 auto;
          padding: 40px;
        }

        .preview-header {
          border-bottom: 2px solid #1a1a1a;
          padding-bottom: 20px;
          margin-bottom: 30px;
        }

        .preview-title {
          font-size: 24px;
          font-weight: 600;
          margin: 0 0 12px;
          color: #1a1a1a;
        }

        .preview-client,
        .preview-project {
          margin: 4px 0;
          color: #666;
          font-size: 14px;
        }

        .preview-section {
          margin-bottom: 24px;
        }

        .preview-section h2 {
          font-size: 16px;
          font-weight: 600;
          margin: 0 0 12px;
          color: #1a1a1a;
          border-bottom: 1px solid #e5e5e5;
          padding-bottom: 8px;
        }

        .preview-section h3 {
          font-size: 14px;
          font-weight: 500;
          margin: 12px 0 8px;
          color: #333;
        }

        .preview-section p {
          margin: 8px 0;
          font-size: 14px;
          line-height: 1.6;
          color: #333;
        }

        .preview-section ul {
          margin: 8px 0;
          padding-left: 20px;
        }

        .rtl .preview-section ul {
          padding-left: 0;
          padding-right: 20px;
        }

        .preview-section li {
          margin: 6px 0;
          font-size: 14px;
          line-height: 1.5;
        }

        .preview-qty,
        .preview-format {
          color: #666;
          font-size: 12px;
        }

        .preview-date {
          color: #666;
          font-size: 13px;
        }

        .preview-exclusions li {
          color: #666;
        }

        .preview-total {
          font-size: 18px;
          margin: 12px 0;
        }

        .preview-terms-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 12px;
        }

        .preview-term-badge {
          display: inline-block;
          padding: 4px 12px;
          background: #f3f4f6;
          border-radius: 4px;
          font-size: 12px;
          color: #374151;
        }

        .preview-footer {
          margin-top: 40px;
          padding-top: 20px;
          border-top: 1px solid #e5e5e5;
        }

        .preview-disclaimer {
          font-size: 11px;
          color: #999;
          font-style: italic;
          text-align: center;
        }
      `})]})}const $t=[{value:"task",label:"Task-Based",description:"One-time project with defined deliverables and timeline"},{value:"retainer",label:"Retainer",description:"Ongoing monthly agreement with recurring work"}],Yt=[{value:"design",label:"Design"},{value:"development",label:"Development"},{value:"consulting",label:"Consulting"},{value:"legal",label:"Legal"},{value:"marketing",label:"Marketing"},{value:"other",label:"Other"}],Xt=[{value:"en",label:"English"},{value:"ar",label:"Arabic (العربية)"}];function Jt({className:t}){const{control:n,watch:i,setValue:s}=Y(),{engagementType:c,setEngagementType:l,engagementCategory:r,setEngagementCategory:d,primaryLanguage:u,setPrimaryLanguage:p,prefillProfileId:a}=q(),{data:N=[]}=ue(),{data:S}=Ze(),{data:v=[]}=he(),b=i("clientId"),k=i("profileId"),{data:E=[]}=et(b||void 0);I.useEffect(()=>{if(!k&&N.length>0){const m=a?N.find(w=>w.id===a):S||N[0];m&&(s("profileId",m.id),s("profileName",m.name))}},[k,N,S,a,s]);const A=m=>{s("profileId",m);const w=N.find(D=>D.id===m);s("profileName",w?.name||"")},L=m=>{s("clientId",m);const w=v.find(D=>D.id===m);s("clientName",w?.name||""),s("projectId",void 0),s("projectName",void 0)},h=m=>{s("projectId",m);const w=E.find(D=>D.id===m);s("projectName",w?.name||void 0)};return e.jsxs("div",{className:C("wizard-step-content",t),children:[e.jsxs("div",{className:"step-header",children:[e.jsx("h2",{className:"step-title",children:"Client Setup"}),e.jsx("p",{className:"step-description",children:"Choose your client and configure the engagement type."})]}),e.jsxs("div",{className:"form-section",children:[e.jsxs("div",{className:"form-group",children:[e.jsx("label",{className:"form-label",children:"Business Profile *"}),e.jsx(F,{name:"profileId",control:n,rules:{required:"Profile is required"},render:({field:m,fieldState:w})=>e.jsxs(e.Fragment,{children:[e.jsxs("select",{className:C("select",w.error&&"select-error"),value:m.value||"",onChange:D=>A(D.target.value),children:[e.jsx("option",{value:"",children:"Select a profile..."}),N.map(D=>e.jsx("option",{value:D.id,children:D.name},D.id))]}),w.error&&e.jsx("p",{className:"form-error",children:w.error.message})]})}),e.jsx("p",{className:"form-hint",children:"The business profile used for this engagement document."})]}),e.jsxs("div",{className:"form-group",children:[e.jsx("label",{className:"form-label",children:"Client *"}),e.jsx(F,{name:"clientId",control:n,rules:{required:"Client is required"},render:({field:m,fieldState:w})=>e.jsxs(e.Fragment,{children:[e.jsxs("select",{className:C("select",w.error&&"select-error"),value:m.value||"",onChange:D=>L(D.target.value),children:[e.jsx("option",{value:"",children:"Select a client..."}),v.map(D=>e.jsx("option",{value:D.id,children:D.name},D.id))]}),w.error&&e.jsx("p",{className:"form-error",children:w.error.message})]})})]}),b&&E.length>0&&e.jsxs("div",{className:"form-group",children:[e.jsx("label",{className:"form-label",children:"Project (Optional)"}),e.jsx(F,{name:"projectId",control:n,render:({field:m})=>e.jsxs("select",{className:"select",value:m.value||"",onChange:w=>h(w.target.value||void 0),children:[e.jsx("option",{value:"",children:"No specific project"}),E.map(w=>e.jsx("option",{value:w.id,children:w.name},w.id))]})}),e.jsx("p",{className:"form-hint",children:"Link this engagement to an existing project for better tracking."})]})]}),e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Engagement Type"}),e.jsx("div",{className:"type-selector",children:$t.map(m=>e.jsxs("button",{type:"button",className:C("type-option",c===m.value&&"type-option-active"),onClick:()=>l(m.value),children:[e.jsx("span",{className:"type-option-label",children:m.label}),e.jsx("span",{className:"type-option-description",children:m.description})]},m.value))})]}),e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Category"}),e.jsx("div",{className:"category-selector",children:Yt.map(m=>e.jsx("button",{type:"button",className:C("category-option",r===m.value&&"category-option-active"),onClick:()=>d(m.value),children:m.label},m.value))})]}),e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Document Language"}),e.jsx("div",{className:"language-selector",children:Xt.map(m=>e.jsx("button",{type:"button",className:C("language-option",u===m.value&&"language-option-active"),onClick:()=>p(m.value),children:m.label},m.value))}),e.jsx("p",{className:"form-hint",children:"The engagement document will be generated in this language."})]}),e.jsx("style",{children:`
        .wizard-step-content {
          max-width: 600px;
        }

        .step-header {
          margin-bottom: 32px;
        }

        .step-title {
          font-size: 20px;
          font-weight: 600;
          margin: 0 0 8px;
        }

        .step-description {
          color: var(--text-muted);
          margin: 0;
          font-size: 14px;
        }

        .form-section {
          margin-bottom: 32px;
        }

        .section-title {
          font-size: 14px;
          font-weight: 600;
          margin: 0 0 12px;
        }

        .type-selector {
          display: grid;
          gap: 12px;
        }

        .type-option {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          padding: 16px;
          background: var(--bg);
          border: 2px solid var(--border);
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.15s ease;
          text-align: left;
        }

        .type-option:hover {
          border-color: var(--primary);
        }

        .type-option-active {
          border-color: var(--primary);
          background: rgba(var(--primary-rgb), 0.05);
        }

        .type-option-label {
          font-weight: 500;
          font-size: 15px;
          margin-bottom: 4px;
        }

        .type-option-description {
          font-size: 13px;
          color: var(--text-muted);
        }

        .category-selector,
        .language-selector {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .category-option,
        .language-option {
          padding: 8px 16px;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          transition: all 0.15s ease;
        }

        .category-option:hover,
        .language-option:hover {
          border-color: var(--primary);
        }

        .category-option-active,
        .language-option-active {
          border-color: var(--primary);
          background: var(--primary);
          color: white;
        }
      `})]})}function Zt({className:t}){const{register:n,formState:{errors:i}}=Y();return e.jsxs("div",{className:C("wizard-step-content",t),children:[e.jsxs("div",{className:"step-header",children:[e.jsx("h2",{className:"step-title",children:"Project Summary"}),e.jsx("p",{className:"step-description",children:"Provide a clear title and summary that will appear at the top of the engagement document."})]}),e.jsxs("div",{className:"form-section",children:[e.jsxs("div",{className:"form-group",children:[e.jsx("label",{className:"form-label",children:"Engagement Title *"}),e.jsx("input",{type:"text",className:C("input",i.title&&"input-error"),placeholder:"e.g., Website Redesign Project",...n("title",{required:"Title is required"})}),i.title&&e.jsx("p",{className:"form-error",children:i.title.message}),e.jsx("p",{className:"form-hint",children:"A clear, descriptive title for this engagement."})]}),e.jsxs("div",{className:"form-group",children:[e.jsx("label",{className:"form-label",children:"Project Summary *"}),e.jsx("textarea",{className:C("textarea",i.summary&&"textarea-error"),rows:5,placeholder:"Describe the project scope and objectives in a few sentences...",...n("summary",{required:"Summary is required"})}),i.summary&&e.jsx("p",{className:"form-error",children:i.summary.message}),e.jsx("p",{className:"form-hint",children:"This summary helps set expectations and appears prominently in the document."})]}),e.jsxs("div",{className:"form-group",children:[e.jsx("label",{className:"form-label",children:"Client's Goal (Optional)"}),e.jsx("textarea",{className:"textarea",rows:3,placeholder:"What is the client trying to achieve? What problem are you solving?",...n("clientGoal")}),e.jsx("p",{className:"form-hint",children:"Understanding the client's goal helps align expectations and demonstrates you understand their needs."})]})]}),e.jsx("style",{children:`
        .wizard-step-content {
          max-width: 600px;
        }

        .step-header {
          margin-bottom: 32px;
        }

        .step-title {
          font-size: 20px;
          font-weight: 600;
          margin: 0 0 8px;
        }

        .step-description {
          color: var(--text-muted);
          margin: 0;
          font-size: 14px;
        }

        .form-section {
          margin-bottom: 32px;
        }

        .textarea {
          min-height: 100px;
          resize: vertical;
        }
      `})]})}function pe(t,n){return t[n]}const ei=[{en:"Brand guidelines",ar:"إرشادات العلامة التجارية"},{en:"Content copy",ar:"المحتوى النصي"},{en:"Logo assets (vector format)",ar:"ملفات الشعار (بصيغة فيكتور)"},{en:"Image assets",ar:"الصور والوسائط"},{en:"Access to existing design files",ar:"الوصول لملفات التصميم الحالية"}],ti=[{en:"API documentation",ar:"توثيق واجهات البرمجة"},{en:"Server/hosting access",ar:"الوصول للخادم/الاستضافة"},{en:"Database credentials",ar:"بيانات قاعدة البيانات"},{en:"Design mockups",ar:"تصاميم الواجهات"},{en:"Functional requirements",ar:"المتطلبات الوظيفية"}],ii=[{en:"Relevant contracts and agreements",ar:"العقود والاتفاقيات ذات الصلة"},{en:"Business registration documents",ar:"وثائق تسجيل الشركة"},{en:"Identification documents",ar:"وثائق الهوية"},{en:"Previous correspondence",ar:"المراسلات السابقة"}],ni=[{en:"Access to key stakeholders",ar:"الوصول لأصحاب المصلحة الرئيسيين"},{en:"Relevant internal documents",ar:"المستندات الداخلية ذات الصلة"},{en:"Current process documentation",ar:"توثيق العمليات الحالية"},{en:"Financial data (if applicable)",ar:"البيانات المالية (إن وجدت)"}],si=[{en:"Brand guidelines",ar:"إرشادات العلامة التجارية"},{en:"Target audience profiles",ar:"ملفات الجمهور المستهدف"},{en:"Competitor analysis",ar:"تحليل المنافسين"},{en:"Access to analytics",ar:"الوصول للتحليلات"},{en:"Social media credentials",ar:"بيانات حسابات التواصل الاجتماعي"}],ai=[{en:"Project requirements document",ar:"وثيقة متطلبات المشروع"},{en:"Access to relevant stakeholders",ar:"الوصول لأصحاب المصلحة"}],ri=[{en:"Photography or photo shoots",ar:"التصوير الفوتوغرافي"},{en:"Copywriting or content creation",ar:"كتابة المحتوى"},{en:"Development or coding",ar:"البرمجة والتطوير"},{en:"Print production",ar:"الإنتاج الطباعي"},{en:"Stock images or fonts licensing",ar:"ترخيص الصور والخطوط"}],oi=[{en:"UI/UX design",ar:"تصميم الواجهات"},{en:"Content creation",ar:"إنشاء المحتوى"},{en:"Server hosting fees",ar:"رسوم الاستضافة"},{en:"Third-party API costs",ar:"تكاليف واجهات الطرف الثالث"},{en:"Ongoing maintenance",ar:"الصيانة المستمرة"}],li=[{en:"Court representation",ar:"التمثيل أمام المحاكم"},{en:"Government filing fees",ar:"رسوم التسجيل الحكومية"},{en:"Notarization costs",ar:"تكاليف التوثيق"},{en:"Translation services",ar:"خدمات الترجمة"}],ci=[{en:"Implementation of recommendations",ar:"تنفيذ التوصيات"},{en:"Ongoing operational support",ar:"الدعم التشغيلي المستمر"},{en:"Staff training",ar:"تدريب الموظفين"},{en:"Technology procurement",ar:"شراء التقنيات"}],di=[{en:"Ad spend budget",ar:"ميزانية الإعلانات"},{en:"Video production",ar:"إنتاج الفيديو"},{en:"Influencer fees",ar:"أتعاب المؤثرين"},{en:"Print production",ar:"الإنتاج الطباعي"},{en:"Event management",ar:"إدارة الفعاليات"}],mi=[{en:"Ongoing support after delivery",ar:"الدعم المستمر بعد التسليم"},{en:"Third-party costs",ar:"تكاليف الأطراف الثالثة"}],pi=[{id:"logo-design",description:{en:"Logo design",ar:"تصميم الشعار"},defaultQuantity:1},{id:"brand-guidelines",description:{en:"Brand guidelines document",ar:"دليل الهوية البصرية"},defaultQuantity:1,defaultFormat:"PDF"},{id:"website-mockup",description:{en:"Website mockup",ar:"تصميم الموقع"},defaultQuantity:1,defaultFormat:"Figma"},{id:"mobile-mockup",description:{en:"Mobile app mockup",ar:"تصميم التطبيق"},defaultQuantity:1,defaultFormat:"Figma"},{id:"social-templates",description:{en:"Social media templates",ar:"قوالب التواصل الاجتماعي"},defaultQuantity:5,defaultFormat:"PNG/PSD"},{id:"business-card",description:{en:"Business card design",ar:"تصميم بطاقة العمل"},defaultQuantity:1},{id:"presentation",description:{en:"Presentation template",ar:"قالب العرض التقديمي"},defaultQuantity:1,defaultFormat:"PPTX"},{id:"icon-set",description:{en:"Custom icon set",ar:"مجموعة أيقونات مخصصة"},defaultQuantity:10,defaultFormat:"SVG"}],ui=[{id:"website",description:{en:"Responsive website",ar:"موقع متجاوب"},defaultQuantity:1},{id:"mobile-app",description:{en:"Mobile application",ar:"تطبيق جوال"},defaultQuantity:1},{id:"web-app",description:{en:"Web application",ar:"تطبيق ويب"},defaultQuantity:1},{id:"api",description:{en:"API development",ar:"تطوير واجهة برمجية"},defaultQuantity:1},{id:"database",description:{en:"Database design & setup",ar:"تصميم وإعداد قاعدة البيانات"},defaultQuantity:1},{id:"integration",description:{en:"Third-party integration",ar:"تكامل مع طرف ثالث"},defaultQuantity:1},{id:"testing",description:{en:"Testing & QA",ar:"الاختبار وضمان الجودة"},defaultQuantity:1},{id:"documentation",description:{en:"Technical documentation",ar:"التوثيق الفني"},defaultQuantity:1,defaultFormat:"MD"}],hi=[{id:"contract-draft",description:{en:"Contract draft",ar:"مسودة العقد"},defaultQuantity:1,defaultFormat:"DOCX"},{id:"contract-review",description:{en:"Contract review",ar:"مراجعة العقد"},defaultQuantity:1},{id:"legal-opinion",description:{en:"Legal opinion",ar:"الرأي القانوني"},defaultQuantity:1,defaultFormat:"PDF"},{id:"terms-conditions",description:{en:"Terms & conditions",ar:"الشروط والأحكام"},defaultQuantity:1},{id:"privacy-policy",description:{en:"Privacy policy",ar:"سياسة الخصوصية"},defaultQuantity:1},{id:"nda",description:{en:"NDA draft",ar:"اتفاقية السرية"},defaultQuantity:1},{id:"incorporation",description:{en:"Incorporation documents",ar:"وثائق التأسيس"},defaultQuantity:1}],gi=[{id:"assessment",description:{en:"Current state assessment",ar:"تقييم الوضع الحالي"},defaultQuantity:1,defaultFormat:"PDF"},{id:"strategy",description:{en:"Strategic recommendations",ar:"التوصيات الاستراتيجية"},defaultQuantity:1,defaultFormat:"PDF"},{id:"roadmap",description:{en:"Implementation roadmap",ar:"خارطة التنفيذ"},defaultQuantity:1,defaultFormat:"PDF"},{id:"workshop",description:{en:"Workshop facilitation",ar:"تيسير ورشة العمل"},defaultQuantity:1},{id:"report",description:{en:"Final report",ar:"التقرير النهائي"},defaultQuantity:1,defaultFormat:"PDF"},{id:"presentation",description:{en:"Executive presentation",ar:"العرض التنفيذي"},defaultQuantity:1,defaultFormat:"PPTX"}],xi=[{id:"marketing-strategy",description:{en:"Marketing strategy",ar:"استراتيجية التسويق"},defaultQuantity:1,defaultFormat:"PDF"},{id:"social-strategy",description:{en:"Social media strategy",ar:"استراتيجية التواصل الاجتماعي"},defaultQuantity:1},{id:"content-calendar",description:{en:"Content calendar",ar:"تقويم المحتوى"},defaultQuantity:1,defaultFormat:"Sheet"},{id:"ad-campaign",description:{en:"Ad campaign setup",ar:"إعداد الحملة الإعلانية"},defaultQuantity:1},{id:"seo-audit",description:{en:"SEO audit",ar:"تدقيق السيو"},defaultQuantity:1,defaultFormat:"PDF"},{id:"analytics-report",description:{en:"Analytics report",ar:"تقرير التحليلات"},defaultQuantity:1,defaultFormat:"PDF"},{id:"email-campaign",description:{en:"Email campaign",ar:"حملة البريد الإلكتروني"},defaultQuantity:1}],vi=[{id:"deliverable-1",description:{en:"Project deliverable",ar:"مخرج المشروع"},defaultQuantity:1},{id:"report",description:{en:"Project report",ar:"تقرير المشروع"},defaultQuantity:1,defaultFormat:"PDF"}],ke={design:{dependencies:ei,exclusions:ri,deliverablePresets:pi},development:{dependencies:ti,exclusions:oi,deliverablePresets:ui},legal:{dependencies:ii,exclusions:li,deliverablePresets:hi},consulting:{dependencies:ni,exclusions:ci,deliverablePresets:gi},marketing:{dependencies:si,exclusions:di,deliverablePresets:xi},other:{dependencies:ai,exclusions:mi,deliverablePresets:vi}};function qe(t,n){const i=ke[t];return{dependencies:i.dependencies.map(s=>pe(s,n)),exclusions:i.exclusions.map(s=>pe(s,n))}}function fi(t,n){return qe(t,n)}function yi(t,n){return ke[t].deliverablePresets.map(s=>({...s,displayText:pe(s.description,n)}))}function bi(t,n,i){const c=ke[n].deliverablePresets.find(l=>l.id===t);return c?{id:G(),description:pe(c.description,i),quantity:c.defaultQuantity,format:c.defaultFormat,source:"preset",presetId:c.id}:null}function ji(t,n,i){return!i&&t.length===0&&n.length===0}function wi({className:t}){const{register:n,control:i,setValue:s,getValues:c}=Y(),{engagementCategory:l,primaryLanguage:r}=q(),[d,u]=I.useState(""),[p,a]=I.useState(""),[N,S]=I.useState(!0),{fields:v,append:b,remove:k}=ne({control:i,name:"deliverables"}),{fields:E,append:A,remove:L}=ne({control:i,name:"exclusions"}),{fields:h,append:m,remove:w}=ne({control:i,name:"dependencies"}),D=I.useMemo(()=>yi(l,r),[l,r]),B=I.useMemo(()=>new Set(v.map(g=>g.presetId).filter(Boolean)),[v]);I.useEffect(()=>{const g=c("dependencies")||[],y=c("exclusions")||[],P=c("defaultsApplied");if(ji(g,y,P)){const K=qe(l,r);s("dependencies",K.dependencies),s("exclusions",K.exclusions),s("defaultsApplied",!0)}},[l,r,c,s]);const M=()=>{b({id:G(),description:"",quantity:1,source:"custom"})},H=g=>{const y=bi(g,l,r);y&&b(y)},V=()=>{d.trim()&&(A(d.trim()),u(""))},Q=()=>{p.trim()&&(m(p.trim()),a(""))},j=()=>{const g=fi(l,r);s("dependencies",g.dependencies),s("exclusions",g.exclusions),s("defaultsApplied",!0)};return e.jsxs("div",{className:C("wizard-step-content",t),children:[e.jsxs("div",{className:"step-header",children:[e.jsx("h2",{className:"step-title",children:"Scope of Work"}),e.jsx("p",{className:"step-description",children:"Define what's included and excluded from this engagement."})]}),e.jsxs("div",{className:"form-section",children:[e.jsxs("div",{className:"section-header",children:[e.jsx("h3",{className:"section-title",children:"Deliverables"}),e.jsx("button",{type:"button",className:"btn btn-ghost btn-sm",onClick:M,children:"+ Add Custom"})]}),e.jsx("p",{className:"section-hint",children:"List the specific outputs the client will receive."}),D.length>0&&e.jsxs("div",{className:"presets-panel",children:[e.jsxs("button",{type:"button",className:"presets-toggle",onClick:()=>S(!N),children:[e.jsx("span",{className:"presets-toggle-icon",children:N?"▼":"▶"}),"Quick Add from Presets"]}),N&&e.jsx("div",{className:"presets-grid",children:D.map(g=>{const y=B.has(g.id);return e.jsxs("button",{type:"button",className:C("preset-chip",y&&"preset-chip-used"),disabled:y,onClick:()=>H(g.id),children:[y?"✓ ":"+ ",g.displayText]},g.id)})})]}),e.jsxs("div",{className:"deliverables-list",children:[v.map((g,y)=>e.jsxs("div",{className:"deliverable-row",children:[e.jsxs("div",{className:"deliverable-main",children:[g.source==="preset"&&e.jsx("span",{className:"deliverable-badge",title:"From preset",children:"P"}),e.jsx("input",{type:"text",className:"input",placeholder:"e.g., Homepage design mockup",...n(`deliverables.${y}.description`)})]}),e.jsx("input",{type:"number",className:"input input-sm",min:"1",style:{width:80},placeholder:"Qty",...n(`deliverables.${y}.quantity`,{valueAsNumber:!0})}),e.jsx("input",{type:"text",className:"input input-sm",style:{width:100},placeholder:"Format",...n(`deliverables.${y}.format`)}),e.jsx("button",{type:"button",className:"btn btn-ghost btn-icon",onClick:()=>k(y),title:"Remove",children:"×"})]},g.id)),v.length===0&&e.jsxs("div",{className:"empty-list",children:[e.jsx("p",{children:"No deliverables added yet."}),e.jsx("button",{type:"button",className:"btn btn-secondary btn-sm",onClick:M,children:"Add First Deliverable"})]})]})]}),e.jsxs("div",{className:"form-section",children:[e.jsxs("div",{className:"section-header",children:[e.jsx("h3",{className:"section-title",children:"Exclusions"}),e.jsx("button",{type:"button",className:"btn btn-ghost btn-sm",onClick:j,title:"Reset to category defaults",children:"↺ Reset Defaults"})]}),e.jsx("p",{className:"section-hint",children:"Clearly state what is NOT included to avoid scope creep."}),e.jsxs("div",{className:"add-item-row",children:[e.jsx("input",{type:"text",className:"input",placeholder:"e.g., Ongoing maintenance, Third-party integrations",value:d,onChange:g=>u(g.target.value),onKeyDown:g=>g.key==="Enter"&&(g.preventDefault(),V())}),e.jsx("button",{type:"button",className:"btn btn-secondary btn-sm",onClick:V,children:"Add"})]}),e.jsx("div",{className:"tags-list",children:E.map((g,y)=>e.jsxs("span",{className:"tag",children:[typeof g=="string"?g:g.value||"",e.jsx("button",{type:"button",className:"tag-remove",onClick:()=>L(y),children:"×"})]},y))})]}),e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Dependencies"}),e.jsx("p",{className:"section-hint",children:"What do you need from the client to proceed?"}),e.jsxs("div",{className:"add-item-row",children:[e.jsx("input",{type:"text",className:"input",placeholder:"e.g., Brand guidelines, Content copy, Server access",value:p,onChange:g=>a(g.target.value),onKeyDown:g=>g.key==="Enter"&&(g.preventDefault(),Q())}),e.jsx("button",{type:"button",className:"btn btn-secondary btn-sm",onClick:Q,children:"Add"})]}),e.jsx("div",{className:"tags-list",children:h.map((g,y)=>e.jsxs("span",{className:"tag tag-dependency",children:[typeof g=="string"?g:g.value||"",e.jsx("button",{type:"button",className:"tag-remove",onClick:()=>w(y),children:"×"})]},y))})]}),e.jsx("style",{children:`
        .wizard-step-content {
          max-width: 700px;
        }

        .step-header {
          margin-bottom: 32px;
        }

        .step-title {
          font-size: 20px;
          font-weight: 600;
          margin: 0 0 8px;
        }

        .step-description {
          color: var(--text-muted);
          margin: 0;
          font-size: 14px;
        }

        .form-section {
          margin-bottom: 32px;
        }

        .section-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
        }

        .section-title {
          font-size: 14px;
          font-weight: 600;
          margin: 0;
        }

        .section-hint {
          color: var(--text-muted);
          font-size: 13px;
          margin: 0 0 12px;
        }

        /* Presets Panel */
        .presets-panel {
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 8px;
          margin-bottom: 16px;
          overflow: hidden;
        }

        .presets-toggle {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 12px;
          background: transparent;
          border: none;
          cursor: pointer;
          font-size: 13px;
          font-weight: 500;
          color: var(--text);
          text-align: left;
        }

        .presets-toggle:hover {
          background: var(--bg-hover);
        }

        .presets-toggle-icon {
          font-size: 10px;
          color: var(--text-muted);
        }

        .presets-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          padding: 0 12px 12px;
        }

        .preset-chip {
          padding: 6px 12px;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 16px;
          cursor: pointer;
          font-size: 12px;
          color: var(--text);
          transition: all 0.15s ease;
        }

        .preset-chip:hover:not(:disabled) {
          border-color: var(--primary);
          background: rgba(var(--primary-rgb), 0.1);
        }

        .preset-chip-used {
          background: rgba(var(--success-rgb, 34, 197, 94), 0.1);
          border-color: var(--success, #22c55e);
          color: var(--success, #22c55e);
          cursor: default;
        }

        /* Deliverables */
        .deliverables-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .deliverable-row {
          display: flex;
          gap: 8px;
          align-items: center;
        }

        .deliverable-main {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .deliverable-main .input {
          flex: 1;
        }

        .deliverable-badge {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 20px;
          height: 20px;
          background: rgba(var(--primary-rgb), 0.1);
          color: var(--primary);
          border-radius: 4px;
          font-size: 10px;
          font-weight: 600;
          flex-shrink: 0;
        }

        .empty-list {
          padding: 24px;
          text-align: center;
          background: var(--bg-elevated);
          border-radius: 8px;
          border: 1px dashed var(--border);
        }

        .empty-list p {
          color: var(--text-muted);
          margin: 0 0 12px;
        }

        .add-item-row {
          display: flex;
          gap: 8px;
          margin-bottom: 12px;
        }

        .add-item-row .input {
          flex: 1;
        }

        .tags-list {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .tag {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 6px;
          font-size: 13px;
        }

        .tag-dependency {
          background: rgba(var(--primary-rgb), 0.1);
          border-color: var(--primary);
        }

        .tag-remove {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 16px;
          height: 16px;
          background: transparent;
          border: none;
          cursor: pointer;
          color: var(--text-muted);
          font-size: 14px;
          line-height: 1;
          border-radius: 50%;
        }

        .tag-remove:hover {
          background: var(--bg-hover);
          color: var(--danger);
        }
      `})]})}function Ni(t,n,i){if(!n||!i||t===0)return Array(t).fill(void 0);const s=new Date(n),l=new Date(i).getTime()-s.getTime();if(l<=0)return Array(t).fill(void 0);const r=[];for(let d=0;d<t;d++){const u=Math.round((d+1)*l/(t+1)),p=new Date(s.getTime()+u);r.push(p.toISOString().split("T")[0])}return r}function Si(t,n,i,s=[]){if(t.length===0)return s;const c=s.filter(p=>p.userEdited),l=new Set(c.flatMap(p=>p.generatedFromDeliverableId?[p.generatedFromDeliverableId]:[])),r=t.filter(p=>!l.has(p.id)),d=Ni(r.length,n,i),u=r.map((p,a)=>({id:G(),title:p.description||`Milestone ${a+1}`,targetDate:d[a],deliverableIds:[p.id],generated:!0,userEdited:!1,generatedFromDeliverableId:p.id}));return[...c,...u]}function ki(t){return t.generated===!0}function Ci({className:t}){const{register:n,control:i,watch:s,setValue:c,getValues:l}=Y(),{fields:r,append:d,remove:u,replace:p}=ne({control:i,name:"milestones"}),a=s("deliverables")||[],N=s("startDate"),S=s("endDate"),v=s("silenceEqualsApproval"),b=()=>{d({id:G(),title:"",targetDate:void 0,deliverableIds:[],generated:!1,userEdited:!1})},k=()=>{const h=l("milestones")||[],m=Si(a,N,S,h);p(m)},E=h=>{const m=r[h];m.generated&&!m.userEdited&&c(`milestones.${h}.userEdited`,!0)},A=h=>{const m=r[h];m.generated&&!m.userEdited&&c(`milestones.${h}.userEdited`,!0)},L=a.length>0;return e.jsxs("div",{className:C("wizard-step-content",t),children:[e.jsxs("div",{className:"step-header",children:[e.jsx("h2",{className:"step-title",children:"Timeline & Milestones"}),e.jsx("p",{className:"step-description",children:"Set project dates and define key milestones for tracking progress."})]}),e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Project Dates"}),e.jsxs("div",{className:"form-row",children:[e.jsxs("div",{className:"form-group",children:[e.jsx("label",{className:"form-label",children:"Start Date"}),e.jsx("input",{type:"date",className:"input",...n("startDate")})]}),e.jsxs("div",{className:"form-group",children:[e.jsx("label",{className:"form-label",children:"Target End Date"}),e.jsx("input",{type:"date",className:"input",...n("endDate")})]})]})]}),e.jsxs("div",{className:"form-section",children:[e.jsxs("div",{className:"section-header",children:[e.jsx("h3",{className:"section-title",children:"Milestones"}),e.jsxs("div",{className:"section-actions",children:[L&&e.jsx("button",{type:"button",className:"btn btn-secondary btn-sm",onClick:k,title:"Generate milestones from deliverables",children:"⚡ Generate from Deliverables"}),e.jsx("button",{type:"button",className:"btn btn-ghost btn-sm",onClick:b,children:"+ Add Milestone"})]})]}),e.jsxs("p",{className:"section-hint",children:["Break the project into phases or checkpoints.",L&&' Click "Generate from Deliverables" to auto-create milestones.']}),e.jsxs("div",{className:"milestones-list",children:[r.map((h,m)=>{const w=h,D=ki(w),B=w.userEdited;return e.jsxs("div",{className:C("milestone-card",D&&!B&&"milestone-generated"),children:[e.jsxs("div",{className:"milestone-header",children:[e.jsxs("div",{className:"milestone-header-left",children:[e.jsxs("span",{className:"milestone-number",children:["#",m+1]}),D&&e.jsx("span",{className:C("milestone-badge",B&&"milestone-badge-edited"),children:B?"Auto (edited)":"Auto"})]}),e.jsx("button",{type:"button",className:"btn btn-ghost btn-icon btn-sm",onClick:()=>u(m),title:"Remove",children:"×"})]}),e.jsxs("div",{className:"milestone-body",children:[e.jsx("div",{className:"form-group",children:e.jsx("input",{type:"text",className:"input",placeholder:"Milestone title (e.g., Design Phase Complete)",...n(`milestones.${m}.title`),onChange:M=>{E(m),n(`milestones.${m}.title`).onChange(M)}})}),e.jsxs("div",{className:"form-group",children:[e.jsx("label",{className:"form-label-sm",children:"Target Date"}),e.jsx("input",{type:"date",className:"input",...n(`milestones.${m}.targetDate`),onChange:M=>{A(m),n(`milestones.${m}.targetDate`).onChange(M)}})]})]})]},h.id)}),r.length===0&&e.jsxs("div",{className:"empty-list",children:[e.jsx("p",{children:"No milestones defined."}),L?e.jsx("button",{type:"button",className:"btn btn-primary btn-sm",onClick:k,children:"Generate from Deliverables"}):e.jsx("button",{type:"button",className:"btn btn-secondary btn-sm",onClick:b,children:"Add First Milestone"})]})]})]}),e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Client Review Period"}),e.jsx("p",{className:"section-hint",children:"How long does the client have to review deliverables before they're considered approved?"}),e.jsx("div",{className:"form-row",children:e.jsxs("div",{className:"form-group",children:[e.jsx("label",{className:"form-label",children:"Review Window (Days)"}),e.jsx(F,{name:"reviewWindowDays",control:i,render:({field:h})=>e.jsx("input",{type:"number",className:"input",min:"0",max:"30",style:{width:100},value:h.value||0,onChange:m=>h.onChange(parseInt(m.target.value)||0)})})]})}),e.jsxs("div",{className:"form-group",children:[e.jsxs("label",{className:"checkbox-label",children:[e.jsx("input",{type:"checkbox",...n("silenceEqualsApproval")}),e.jsx("span",{children:"Silence equals approval"})]}),e.jsx("p",{className:"form-hint",children:v?"If the client doesn't respond within the review window, deliverables are considered approved.":"Explicit approval is required for each deliverable."})]})]}),e.jsx("style",{children:`
        .wizard-step-content {
          max-width: 700px;
        }

        .step-header {
          margin-bottom: 32px;
        }

        .step-title {
          font-size: 20px;
          font-weight: 600;
          margin: 0 0 8px;
        }

        .step-description {
          color: var(--text-muted);
          margin: 0;
          font-size: 14px;
        }

        .form-section {
          margin-bottom: 32px;
        }

        .section-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
          flex-wrap: wrap;
          gap: 8px;
        }

        .section-actions {
          display: flex;
          gap: 8px;
        }

        .section-title {
          font-size: 14px;
          font-weight: 600;
          margin: 0;
        }

        .section-hint {
          color: var(--text-muted);
          font-size: 13px;
          margin: 0 0 12px;
        }

        .form-row {
          display: flex;
          gap: 16px;
          flex-wrap: wrap;
        }

        .form-row .form-group {
          flex: 1;
          min-width: 150px;
        }

        .milestones-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .milestone-card {
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 8px;
          overflow: hidden;
        }

        .milestone-generated {
          border-color: rgba(var(--primary-rgb), 0.3);
          background: rgba(var(--primary-rgb), 0.02);
        }

        .milestone-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          background: var(--bg);
          border-bottom: 1px solid var(--border);
        }

        .milestone-header-left {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .milestone-number {
          font-size: 12px;
          font-weight: 500;
          color: var(--text-muted);
        }

        .milestone-badge {
          font-size: 10px;
          padding: 2px 6px;
          background: rgba(var(--primary-rgb), 0.1);
          color: var(--primary);
          border-radius: 4px;
          font-weight: 500;
        }

        .milestone-badge-edited {
          background: rgba(var(--warning-rgb, 234, 179, 8), 0.1);
          color: var(--warning, #eab308);
        }

        .milestone-body {
          padding: 12px;
        }

        .milestone-body .form-group {
          margin-bottom: 8px;
        }

        .milestone-body .form-group:last-child {
          margin-bottom: 0;
        }

        .form-label-sm {
          display: block;
          font-size: 12px;
          color: var(--text-muted);
          margin-bottom: 4px;
        }

        .empty-list {
          padding: 24px;
          text-align: center;
          background: var(--bg-elevated);
          border-radius: 8px;
          border: 1px dashed var(--border);
        }

        .empty-list p {
          color: var(--text-muted);
          margin: 0 0 12px;
          font-size: 13px;
        }

        .checkbox-label {
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          font-size: 14px;
        }

        .checkbox-label input {
          width: 16px;
          height: 16px;
        }
      `})]})}const Ei=[{id:"minor_text",label:"Minor text changes"},{id:"color_adjust",label:"Color/font adjustments"},{id:"layout_change",label:"Layout changes"},{id:"new_element",label:"Adding new elements"},{id:"concept_change",label:"Concept direction change"},{id:"functionality",label:"Functionality changes"}];function Di({className:t}){const{register:n,control:i,watch:s,setValue:c}=Y(),{engagementType:l,engagementCategory:r}=q(),[d,u]=I.useState(""),p=l==="task",a=l==="retainer",N=r==="design",S=r==="development",v=s("revisionDefinition")||[],{fields:b,append:k,remove:E}=ne({control:i,name:"scopeCategories"}),A=h=>{const m=v;m.includes(h)?c("revisionDefinition",m.filter(w=>w!==h)):c("revisionDefinition",[...m,h])},L=()=>{d.trim()&&(k(d.trim()),u(""))};return e.jsxs("div",{className:C("wizard-step-content",t),children:[e.jsxs("div",{className:"step-header",children:[e.jsx("h2",{className:"step-title",children:p?"Revisions & Support":"Capacity & Scope"}),e.jsx("p",{className:"step-description",children:p?"Define revision rounds and post-delivery support.":"Set capacity limits and scope boundaries for the retainer."})]}),p&&e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Revision Rounds"}),e.jsx("p",{className:"section-hint",children:"How many rounds of revisions are included in the price?"}),e.jsx("div",{className:"form-row",children:e.jsxs("div",{className:"form-group",children:[e.jsx("label",{className:"form-label",children:"Included Revisions"}),e.jsx(F,{name:"revisionRounds",control:i,render:({field:h})=>e.jsx("input",{type:"number",className:"input",min:"0",max:"10",style:{width:100},value:h.value||0,onChange:m=>h.onChange(parseInt(m.target.value)||0)})}),e.jsx("p",{className:"form-hint",children:"Set to 0 for unlimited revisions (not recommended)."})]})}),N&&e.jsxs("div",{className:"form-group",children:[e.jsx("label",{className:"form-label",children:"What counts as a revision?"}),e.jsx("p",{className:"form-hint",children:"Select which changes count toward revision rounds."}),e.jsx("div",{className:"checkbox-grid",children:Ei.map(h=>e.jsxs("label",{className:"checkbox-label",children:[e.jsx("input",{type:"checkbox",checked:v.includes(h.id),onChange:()=>A(h.id)}),e.jsx("span",{children:h.label})]},h.id))})]}),e.jsxs("div",{className:"form-group",children:[e.jsxs("label",{className:"checkbox-label",children:[e.jsx("input",{type:"checkbox",...n("changeRequestRule")}),e.jsx("span",{children:"Changes beyond scope require a change request"})]}),e.jsx("p",{className:"form-hint",children:"If enabled, changes outside the original scope will be quoted separately."})]})]}),p&&S&&e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Post-Delivery Support"}),e.jsxs("div",{className:"form-group",children:[e.jsx("label",{className:"form-label",children:"Bug Fix Window (Days)"}),e.jsx(F,{name:"bugFixDays",control:i,render:({field:h})=>e.jsx("input",{type:"number",className:"input",min:"0",max:"90",style:{width:100},value:h.value||0,onChange:m=>h.onChange(parseInt(m.target.value)||0)})}),e.jsx("p",{className:"form-hint",children:"How many days after delivery will you fix bugs at no extra cost?"})]})]}),a&&e.jsxs(e.Fragment,{children:[e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Scope Categories"}),e.jsx("p",{className:"section-hint",children:"Define what types of work are included in the retainer."}),e.jsxs("div",{className:"add-item-row",children:[e.jsx("input",{type:"text",className:"input",placeholder:"e.g., Bug fixes, Feature development, Meetings",value:d,onChange:h=>u(h.target.value),onKeyDown:h=>h.key==="Enter"&&(h.preventDefault(),L())}),e.jsx("button",{type:"button",className:"btn btn-secondary btn-sm",onClick:L,children:"Add"})]}),e.jsx("div",{className:"tags-list",children:b.map((h,m)=>e.jsxs("span",{className:"tag",children:[typeof h=="string"?h:h.value||"",e.jsx("button",{type:"button",className:"tag-remove",onClick:()=>E(m),children:"×"})]},m))})]}),e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Monthly Capacity"}),e.jsxs("div",{className:"form-group",children:[e.jsx("label",{className:"form-label",children:"Capacity Description"}),e.jsx("input",{type:"text",className:"input",placeholder:"e.g., Up to 20 hours, 4 design assets, 2 feature requests",...n("monthlyCapacity")}),e.jsx("p",{className:"form-hint",children:"Describe what's included each month. Leave blank for unlimited (not recommended)."})]})]}),e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Response Time"}),e.jsxs("div",{className:"form-group",children:[e.jsx("label",{className:"form-label",children:"Response Time (Business Days)"}),e.jsx(F,{name:"responseTimeDays",control:i,render:({field:h})=>e.jsx("input",{type:"number",className:"input",min:"0",max:"14",style:{width:100},value:h.value||0,onChange:m=>h.onChange(parseInt(m.target.value)||0)})}),e.jsx("p",{className:"form-hint",children:"Maximum time to respond to client requests."})]})]})]}),e.jsx("style",{children:`
        .wizard-step-content {
          max-width: 700px;
        }

        .step-header {
          margin-bottom: 32px;
        }

        .step-title {
          font-size: 20px;
          font-weight: 600;
          margin: 0 0 8px;
        }

        .step-description {
          color: var(--text-muted);
          margin: 0;
          font-size: 14px;
        }

        .form-section {
          margin-bottom: 32px;
        }

        .section-title {
          font-size: 14px;
          font-weight: 600;
          margin: 0 0 8px;
        }

        .section-hint {
          color: var(--text-muted);
          font-size: 13px;
          margin: 0 0 12px;
        }

        .form-row {
          display: flex;
          gap: 16px;
          flex-wrap: wrap;
        }

        .checkbox-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
          gap: 8px;
          margin-top: 12px;
        }

        .checkbox-label {
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          font-size: 13px;
        }

        .checkbox-label input {
          width: 16px;
          height: 16px;
        }

        .add-item-row {
          display: flex;
          gap: 8px;
          margin-bottom: 12px;
        }

        .add-item-row .input {
          flex: 1;
        }

        .tags-list {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .tag {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 6px;
          font-size: 13px;
        }

        .tag-remove {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 16px;
          height: 16px;
          background: transparent;
          border: none;
          cursor: pointer;
          color: var(--text-muted);
          font-size: 14px;
          line-height: 1;
          border-radius: 50%;
        }

        .tag-remove:hover {
          background: var(--bg-hover);
          color: var(--danger);
        }
      `})]})}const He=6;function Ii(t,n,i){if(t.length===0||n<=0)return[];const s=t.slice(0,He),c=Math.floor(n/s.length),l=n-c*s.length;return s.map((r,d)=>({id:G(),label:r.title||`Payment ${d+1}`,trigger:"on_milestone",milestoneId:r.id,amountMinor:c+(d===s.length-1?l:0),currency:i,generated:!0,userEdited:!1,generatedFromMilestoneId:r.id}))}function Ti(t,n,i){if(t.length===0||n<=0)return[];const s=Math.min(t.length,He),c=Math.floor(n/s),l=n-c*s;return t.slice(0,s).map((r,d)=>({id:G(),label:r.description||`Payment ${d+1}`,trigger:"on_completion",amountMinor:c+(d===s-1?l:0),currency:i,generated:!0,userEdited:!1}))}function Pi(t,n,i="en"){if(t<=0)return[];const s={en:{deposit:"Deposit (30%)",agreement:"Agreement (40%)",completion:"Completion (30%)"},ar:{deposit:"الدفعة الأولى (30%)",agreement:"الاتفاق (40%)",completion:"عند الإنجاز (30%)"}},c=Math.round(t*.3),l=Math.round(t*.4),r=t-c-l;return[{id:G(),label:s[i].deposit,trigger:"on_signing",amountMinor:c,currency:n,generated:!0,userEdited:!1},{id:G(),label:s[i].agreement,trigger:"on_milestone",amountMinor:l,currency:n,generated:!0,userEdited:!1},{id:G(),label:s[i].completion,trigger:"on_completion",amountMinor:r,currency:n,generated:!0,userEdited:!1}]}function Qe(t,n,i,s,c=[],l="en"){const r=c.filter(a=>a.userEdited),d=r.reduce((a,N)=>a+N.amountMinor,0),u=i-d;if(u<=0)return r;let p;if(t.length>0){const a=new Set(r.filter(S=>S.generatedFromMilestoneId).map(S=>S.generatedFromMilestoneId)),N=t.filter(S=>!a.has(S.id));p=Ii(N,u,s)}else n.length>0?p=Ti(n,u,s):p=Pi(u,s,l);return[...r,...p]}function Ri(t,n,i,s,c="en"){return Qe(t,n,i,s,[],c)}function Ai(t,n){return t.length===0&&n>0}const Le=[{value:"USD",label:"USD",symbol:"$"},{value:"ILS",label:"ILS",symbol:"₪"},{value:"EUR",label:"EUR",symbol:"€"}],Li=[{value:"on_signing",label:"On signing"},{value:"on_milestone",label:"On milestone"},{value:"on_completion",label:"On completion"},{value:"monthly",label:"Monthly"}],zi=[{value:"none",label:"No rollover",description:"Unused hours/capacity expire at month end"},{value:"carry",label:"Carry forward",description:"Unused capacity rolls to next month"},{value:"expire",label:"Use or lose",description:"Unused capacity is forfeited"}];function Fi({className:t}){const{register:n,control:i,watch:s,setValue:c,getValues:l}=Y(),{engagementType:r,primaryLanguage:d}=q(),u=I.useRef(!1),p=r==="task",a=r==="retainer",N=s("currency")||"USD",S=s("totalAmountMinor")||0,v=s("depositPercent")||0,b=s("milestones")||[],k=s("deliverables")||[],{fields:E,append:A,remove:L,replace:h}=ne({control:i,name:"scheduleItems"}),m=Le.find(g=>g.value===N)?.symbol||"$",w=g=>(g/100).toFixed(2),D=g=>Math.round(parseFloat(g||"0")*100);I.useEffect(()=>{if(u.current)return;const g=l("scheduleItems")||[],y=l("totalAmountMinor")||0;if(Ai(g,y)){const P=Qe(b,k,y,N,[],d);h(P),u.current=!0}},[l,b,k,N,d,h]);const B=()=>{A({id:G(),label:"",trigger:"on_milestone",amountMinor:0,currency:N,generated:!1,userEdited:!1})},M=()=>{const g=Ri(b,k,S,N,d);h(g)},H=g=>{const y=E[g];y.generated&&!y.userEdited&&c(`scheduleItems.${g}.userEdited`,!0)},V=Math.round(S*v/100),Q=E.reduce((g,y)=>g+(y.amountMinor||0),0),j=S-Q;return e.jsxs("div",{className:C("wizard-step-content",t),children:[e.jsxs("div",{className:"step-header",children:[e.jsx("h2",{className:"step-title",children:"Payment Terms"}),e.jsx("p",{className:"step-description",children:p?"Set the total price and payment schedule.":"Configure retainer pricing and billing."})]}),e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Currency"}),e.jsx("div",{className:"currency-selector",children:Le.map(g=>e.jsxs("button",{type:"button",className:C("currency-option",N===g.value&&"currency-option-active"),onClick:()=>c("currency",g.value),children:[g.symbol," ",g.label]},g.value))})]}),p&&e.jsxs(e.Fragment,{children:[e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Project Total"}),e.jsx("div",{className:"form-row",children:e.jsxs("div",{className:"form-group",children:[e.jsx("label",{className:"form-label",children:"Total Amount"}),e.jsxs("div",{className:"input-with-prefix",children:[e.jsx("span",{className:"input-prefix",children:m}),e.jsx(F,{name:"totalAmountMinor",control:i,render:({field:g})=>e.jsx("input",{type:"number",step:"0.01",min:"0",className:"input",value:w(g.value||0),onChange:y=>g.onChange(D(y.target.value))})})]})]})})]}),e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Deposit"}),e.jsxs("div",{className:"form-row",children:[e.jsxs("div",{className:"form-group",children:[e.jsx("label",{className:"form-label",children:"Deposit Percentage"}),e.jsxs("div",{className:"input-with-suffix",children:[e.jsx(F,{name:"depositPercent",control:i,render:({field:g})=>e.jsx("input",{type:"number",min:"0",max:"100",className:"input",style:{width:100},value:g.value||0,onChange:y=>g.onChange(parseInt(y.target.value)||0)})}),e.jsx("span",{className:"input-suffix",children:"%"})]})]}),v>0&&S>0&&e.jsxs("div",{className:"form-group",children:[e.jsx("label",{className:"form-label",children:"Deposit Amount"}),e.jsxs("p",{className:"calculated-value",children:[m,w(V)]})]})]}),e.jsx("p",{className:"form-hint",children:"A deposit protects your work and shows client commitment."})]}),e.jsxs("div",{className:"form-section",children:[e.jsxs("div",{className:"section-header",children:[e.jsx("h3",{className:"section-title",children:"Payment Schedule"}),e.jsxs("div",{className:"section-actions",children:[(b.length>0||k.length>0)&&e.jsx("button",{type:"button",className:"btn btn-secondary btn-sm",onClick:M,title:"Regenerate schedule from milestones/deliverables",children:"↺ Reset Schedule"}),e.jsx("button",{type:"button",className:"btn btn-ghost btn-sm",onClick:B,children:"+ Add Payment"})]})]}),E.length>0&&S>0&&j!==0&&e.jsx("div",{className:C("schedule-alert",j>0?"schedule-alert-warning":"schedule-alert-error"),children:j>0?`${m}${w(j)} remaining to allocate`:`Schedule exceeds total by ${m}${w(Math.abs(j))}`}),e.jsx("div",{className:"schedule-list",children:E.map((g,y)=>{const P=g,K=P.generated,Z=P.userEdited;return e.jsxs("div",{className:C("schedule-item",K&&!Z&&"schedule-item-generated"),children:[e.jsxs("div",{className:"schedule-item-main",children:[K&&e.jsx("span",{className:C("schedule-badge",Z&&"schedule-badge-edited"),title:Z?"Auto-generated (edited)":"Auto-generated",children:Z?"A*":"A"}),e.jsx("input",{type:"text",className:"input",placeholder:"Payment label",...n(`scheduleItems.${y}.label`),onChange:$=>{H(y),n(`scheduleItems.${y}.label`).onChange($)}})]}),e.jsx(F,{name:`scheduleItems.${y}.trigger`,control:i,render:({field:$})=>e.jsx("select",{className:"select",value:$.value,onChange:U=>{H(y),$.onChange(U.target.value)},children:Li.filter(U=>U.value!=="monthly").map(U=>e.jsx("option",{value:U.value,children:U.label},U.value))})}),e.jsxs("div",{className:"input-with-prefix",style:{width:150},children:[e.jsx("span",{className:"input-prefix",children:m}),e.jsx(F,{name:`scheduleItems.${y}.amountMinor`,control:i,render:({field:$})=>e.jsx("input",{type:"number",step:"0.01",min:"0",className:"input",value:w($.value||0),onChange:U=>{H(y),$.onChange(D(U.target.value))}})})]}),e.jsx("button",{type:"button",className:"btn btn-ghost btn-icon",onClick:()=>L(y),children:"×"})]},g.id)})}),E.length===0&&S>0&&e.jsxs("div",{className:"empty-schedule",children:[e.jsx("p",{children:"No payment schedule defined."}),b.length>0||k.length>0?e.jsxs("button",{type:"button",className:"btn btn-primary btn-sm",onClick:M,children:["Generate from ",b.length>0?"Milestones":"Deliverables"]}):e.jsx("button",{type:"button",className:"btn btn-secondary btn-sm",onClick:B,children:"Add First Payment"})]})]})]}),a&&e.jsxs(e.Fragment,{children:[e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Monthly Retainer"}),e.jsxs("div",{className:"form-row",children:[e.jsxs("div",{className:"form-group",children:[e.jsx("label",{className:"form-label",children:"Monthly Amount"}),e.jsxs("div",{className:"input-with-prefix",children:[e.jsx("span",{className:"input-prefix",children:m}),e.jsx(F,{name:"retainerAmountMinor",control:i,render:({field:g})=>e.jsx("input",{type:"number",step:"0.01",min:"0",className:"input",value:w(g.value||0),onChange:y=>g.onChange(D(y.target.value))})})]})]}),e.jsxs("div",{className:"form-group",children:[e.jsx("label",{className:"form-label",children:"Billing Day"}),e.jsx(F,{name:"billingDay",control:i,render:({field:g})=>e.jsx("select",{className:"select",value:g.value||1,onChange:y=>g.onChange(parseInt(y.target.value)),children:Array.from({length:28},(y,P)=>P+1).map(y=>e.jsx("option",{value:y,children:y===1?"1st":y===2?"2nd":y===3?"3rd":`${y}th`},y))})})]})]})]}),e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Capacity Rollover"}),e.jsx("div",{className:"rollover-options",children:zi.map(g=>e.jsx(F,{name:"rolloverRule",control:i,render:({field:y})=>e.jsxs("label",{className:C("rollover-option",y.value===g.value&&"active"),children:[e.jsx("input",{type:"radio",value:g.value,checked:y.value===g.value,onChange:P=>y.onChange(P.target.value)}),e.jsxs("div",{children:[e.jsx("span",{className:"rollover-label",children:g.label}),e.jsx("span",{className:"rollover-desc",children:g.description})]})]})},g.value))})]}),e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Out-of-Scope Rate"}),e.jsxs("div",{className:"form-group",children:[e.jsx("label",{className:"form-label",children:"Hourly Rate for Extra Work"}),e.jsxs("div",{className:"input-with-prefix",children:[e.jsx("span",{className:"input-prefix",children:m}),e.jsx(F,{name:"outOfScopeRateMinor",control:i,render:({field:g})=>e.jsx("input",{type:"number",step:"0.01",min:"0",className:"input",style:{width:120},value:w(g.value||0),onChange:y=>g.onChange(D(y.target.value))})})]}),e.jsx("p",{className:"form-hint",children:"Rate charged for work beyond the monthly capacity."})]})]})]}),e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Late Payment"}),e.jsxs("div",{className:"form-group",children:[e.jsxs("label",{className:"checkbox-label",children:[e.jsx("input",{type:"checkbox",...n("lateFeeEnabled")}),e.jsx("span",{children:"Enable late payment fee"})]}),e.jsx("p",{className:"form-hint",children:"A late fee clause encourages timely payments."})]})]}),e.jsx("style",{children:`
        .wizard-step-content {
          max-width: 700px;
        }

        .step-header {
          margin-bottom: 32px;
        }

        .step-title {
          font-size: 20px;
          font-weight: 600;
          margin: 0 0 8px;
        }

        .step-description {
          color: var(--text-muted);
          margin: 0;
          font-size: 14px;
        }

        .form-section {
          margin-bottom: 32px;
        }

        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
          flex-wrap: wrap;
          gap: 8px;
        }

        .section-actions {
          display: flex;
          gap: 8px;
        }

        .section-title {
          font-size: 14px;
          font-weight: 600;
          margin: 0 0 8px;
        }

        .form-row {
          display: flex;
          gap: 16px;
          flex-wrap: wrap;
        }

        .currency-selector {
          display: flex;
          gap: 8px;
        }

        .currency-option {
          padding: 8px 16px;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          transition: all 0.15s ease;
        }

        .currency-option:hover {
          border-color: var(--primary);
        }

        .currency-option-active {
          border-color: var(--primary);
          background: var(--primary);
          color: white;
        }

        .input-with-prefix,
        .input-with-suffix {
          display: flex;
          align-items: center;
        }

        .input-prefix {
          padding: 8px 12px;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-right: none;
          border-radius: 6px 0 0 6px;
          color: var(--text-muted);
        }

        .input-with-prefix .input {
          border-radius: 0 6px 6px 0;
        }

        .input-suffix {
          padding: 8px 12px;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-left: none;
          border-radius: 0 6px 6px 0;
          color: var(--text-muted);
        }

        .input-with-suffix .input {
          border-radius: 6px 0 0 6px;
        }

        .calculated-value {
          font-size: 18px;
          font-weight: 500;
          margin: 0;
          padding-top: 8px;
        }

        .schedule-alert {
          padding: 8px 12px;
          border-radius: 6px;
          font-size: 13px;
          margin-bottom: 12px;
        }

        .schedule-alert-warning {
          background: rgba(var(--warning-rgb, 234, 179, 8), 0.1);
          color: var(--warning, #eab308);
          border: 1px solid rgba(var(--warning-rgb, 234, 179, 8), 0.3);
        }

        .schedule-alert-error {
          background: rgba(var(--danger-rgb, 239, 68, 68), 0.1);
          color: var(--danger, #ef4444);
          border: 1px solid rgba(var(--danger-rgb, 239, 68, 68), 0.3);
        }

        .schedule-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .schedule-item {
          display: flex;
          gap: 8px;
          align-items: center;
        }

        .schedule-item-generated {
          background: rgba(var(--primary-rgb), 0.02);
          padding: 8px;
          border-radius: 6px;
          border: 1px solid rgba(var(--primary-rgb), 0.2);
          margin: -8px;
        }

        .schedule-item-main {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .schedule-item-main .input {
          flex: 1;
        }

        .schedule-badge {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 20px;
          height: 20px;
          background: rgba(var(--primary-rgb), 0.1);
          color: var(--primary);
          border-radius: 4px;
          font-size: 10px;
          font-weight: 600;
          flex-shrink: 0;
        }

        .schedule-badge-edited {
          background: rgba(var(--warning-rgb, 234, 179, 8), 0.1);
          color: var(--warning, #eab308);
        }

        .schedule-item .select {
          width: 140px;
        }

        .empty-schedule {
          padding: 24px;
          text-align: center;
          background: var(--bg-elevated);
          border-radius: 8px;
          border: 1px dashed var(--border);
        }

        .empty-schedule p {
          color: var(--text-muted);
          margin: 0 0 12px;
          font-size: 13px;
        }

        .rollover-options {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .rollover-option {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          padding: 12px;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 8px;
          cursor: pointer;
        }

        .rollover-option.active {
          border-color: var(--primary);
          background: rgba(var(--primary-rgb), 0.05);
        }

        .rollover-option input {
          margin-top: 2px;
        }

        .rollover-label {
          display: block;
          font-weight: 500;
          font-size: 14px;
        }

        .rollover-desc {
          display: block;
          font-size: 12px;
          color: var(--text-muted);
          margin-top: 2px;
        }

        .checkbox-label {
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          font-size: 14px;
        }

        .checkbox-label input {
          width: 16px;
          height: 16px;
        }
      `})]})}const Mi=[{value:"fixed",label:"Fixed Term",description:"Agreement ends on a specific date or upon project completion"},{value:"month-to-month",label:"Month-to-Month",description:"Agreement continues until either party terminates"}],Oi=[{value:"upon_full_payment",label:"Upon full payment"},{value:"upon_milestone_payment",label:"Upon milestone payment"},{value:"upon_final_delivery",label:"Upon final delivery"},{value:"immediately",label:"Immediately upon creation"},{value:"licensed",label:"Work remains licensed, not transferred"}];function Bi({className:t}){const{register:n,control:i,watch:s}=Y(),{engagementType:c}=q(),l=s("termType")||"fixed",r=c==="retainer";return e.jsxs("div",{className:C("wizard-step-content",t),children:[e.jsxs("div",{className:"step-header",children:[e.jsx("h2",{className:"step-title",children:"Relationship Terms"}),e.jsx("p",{className:"step-description",children:"Define how the engagement can be ended and how ownership transfers."})]}),e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Agreement Term"}),e.jsx("div",{className:"term-options",children:Mi.map(d=>e.jsx(F,{name:"termType",control:i,render:({field:u})=>e.jsxs("label",{className:C("term-option",u.value===d.value&&"active"),children:[e.jsx("input",{type:"radio",value:d.value,checked:u.value===d.value,onChange:p=>u.onChange(p.target.value)}),e.jsxs("div",{children:[e.jsx("span",{className:"term-label",children:d.label}),e.jsx("span",{className:"term-desc",children:d.description})]})]})},d.value))})]}),e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Termination Notice"}),e.jsx("p",{className:"section-hint",children:"How much notice is required to end the agreement?"}),e.jsx("div",{className:"form-row",children:e.jsxs("div",{className:"form-group",children:[e.jsx("label",{className:"form-label",children:"Notice Period (Days)"}),e.jsx(F,{name:"terminationNoticeDays",control:i,render:({field:d})=>e.jsx("input",{type:"number",min:"0",max:"90",className:"input",style:{width:100},value:d.value||0,onChange:u=>d.onChange(parseInt(u.target.value)||0)})})]})}),e.jsx("p",{className:"form-hint",children:l==="month-to-month"?"Either party must give this much notice to end the agreement.":"Client must give this much notice to cancel before completion."})]}),l==="fixed"&&!r&&e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Early Cancellation"}),e.jsx("p",{className:"section-hint",children:"What percentage of the remaining amount is owed if the client cancels early?"}),e.jsx("div",{className:"form-row",children:e.jsxs("div",{className:"form-group",children:[e.jsx("label",{className:"form-label",children:"Cancellation Coverage"}),e.jsxs("div",{className:"input-with-suffix",children:[e.jsx(F,{name:"cancellationCoveragePercent",control:i,render:({field:d})=>e.jsx("input",{type:"number",min:"0",max:"100",className:"input",style:{width:100},value:d.value||0,onChange:u=>d.onChange(parseInt(u.target.value)||0)})}),e.jsx("span",{className:"input-suffix",children:"%"})]})]})}),e.jsx("p",{className:"form-hint",children:"Common values: 25-50% of remaining amount."})]}),e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Ownership Transfer"}),e.jsx("p",{className:"section-hint",children:"When does ownership of the work transfer to the client?"}),e.jsx("div",{className:"form-group",children:e.jsx(F,{name:"ownershipTransferRule",control:i,render:({field:d})=>e.jsx("select",{className:"select",value:d.value||"upon_full_payment",onChange:u=>d.onChange(u.target.value),children:Oi.map(u=>e.jsx("option",{value:u.value,children:u.label},u.value))})})}),e.jsx("p",{className:"form-hint",children:`"Upon full payment" is recommended to protect your work until you're paid.`})]}),e.jsx("style",{children:`
        .wizard-step-content {
          max-width: 700px;
        }

        .step-header {
          margin-bottom: 32px;
        }

        .step-title {
          font-size: 20px;
          font-weight: 600;
          margin: 0 0 8px;
        }

        .step-description {
          color: var(--text-muted);
          margin: 0;
          font-size: 14px;
        }

        .form-section {
          margin-bottom: 32px;
        }

        .section-title {
          font-size: 14px;
          font-weight: 600;
          margin: 0 0 8px;
        }

        .section-hint {
          color: var(--text-muted);
          font-size: 13px;
          margin: 0 0 12px;
        }

        .form-row {
          display: flex;
          gap: 16px;
          flex-wrap: wrap;
        }

        .term-options {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .term-option {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          padding: 16px;
          background: var(--bg);
          border: 2px solid var(--border);
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .term-option:hover {
          border-color: var(--primary);
        }

        .term-option.active {
          border-color: var(--primary);
          background: rgba(var(--primary-rgb), 0.05);
        }

        .term-option input {
          margin-top: 2px;
        }

        .term-label {
          display: block;
          font-weight: 500;
          font-size: 15px;
        }

        .term-desc {
          display: block;
          font-size: 13px;
          color: var(--text-muted);
          margin-top: 4px;
        }

        .input-with-suffix {
          display: flex;
          align-items: center;
        }

        .input-suffix {
          padding: 8px 12px;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-left: none;
          border-radius: 0 6px 6px 0;
          color: var(--text-muted);
        }

        .input-with-suffix .input {
          border-radius: 6px 0 0 6px;
        }
      `})]})}const _i=[{name:"confidentiality",label:"Confidentiality",description:"Both parties agree to keep confidential information private."},{name:"ipOwnership",label:"IP Ownership",description:"Intellectual property rights and their transfer are clearly defined."},{name:"warrantyDisclaimer",label:"Warranty Disclaimer",description:'Work is provided "as is" without implied warranties.'},{name:"limitationOfLiability",label:"Limitation of Liability",description:"Liability is limited to the amount paid under this agreement."},{name:"nonSolicitation",label:"Non-Solicitation",description:"Neither party will solicit the other's employees or contractors."}],Vi=[{value:"negotiation",label:"Good Faith Negotiation",description:"Parties will first attempt to resolve disputes through direct discussion."},{value:"mediation",label:"Mediation",description:"Unresolved disputes go to a neutral mediator before any legal action."},{value:"arbitration",label:"Binding Arbitration",description:"Disputes are resolved by a binding arbitration process."}];function Ui({className:t}){const{register:n,control:i,watch:s}=Y();return e.jsxs("div",{className:C("wizard-step-content",t),children:[e.jsxs("div",{className:"step-header",children:[e.jsx("h2",{className:"step-title",children:"Standard Terms"}),e.jsx("p",{className:"step-description",children:"Select which standard legal clauses to include in the agreement."})]}),e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Legal Clauses"}),e.jsx("p",{className:"section-hint",children:"These are common protective clauses. Enable the ones relevant to your engagement."}),e.jsx("div",{className:"terms-list",children:_i.map(c=>e.jsxs("label",{className:"term-toggle",children:[e.jsxs("div",{className:"term-info",children:[e.jsx("span",{className:"term-label",children:c.label}),e.jsx("span",{className:"term-desc",children:c.description})]}),e.jsx("input",{type:"checkbox",className:"toggle",...n(c.name)})]},c.name))})]}),e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Dispute Resolution"}),e.jsx("p",{className:"section-hint",children:"How should disputes be resolved if they arise?"}),e.jsx("div",{className:"dispute-options",children:Vi.map(c=>e.jsx(F,{name:"disputePath",control:i,render:({field:l})=>e.jsxs("label",{className:C("dispute-option",l.value===c.value&&"active"),children:[e.jsx("input",{type:"radio",value:c.value,checked:l.value===c.value,onChange:r=>l.onChange(r.target.value)}),e.jsxs("div",{children:[e.jsx("span",{className:"dispute-label",children:c.label}),e.jsx("span",{className:"dispute-desc",children:c.description})]})]})},c.value))})]}),e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Governing Law"}),e.jsx("p",{className:"section-hint",children:"Which jurisdiction's laws govern this agreement?"}),e.jsxs("div",{className:"form-group",children:[e.jsx("input",{type:"text",className:"input",placeholder:"e.g., State of Delaware, USA",...n("governingLaw")}),e.jsx("p",{className:"form-hint",children:"Optional. If not specified, the laws of your location typically apply."})]})]}),e.jsx("style",{children:`
        .wizard-step-content {
          max-width: 700px;
        }

        .step-header {
          margin-bottom: 32px;
        }

        .step-title {
          font-size: 20px;
          font-weight: 600;
          margin: 0 0 8px;
        }

        .step-description {
          color: var(--text-muted);
          margin: 0;
          font-size: 14px;
        }

        .form-section {
          margin-bottom: 32px;
        }

        .section-title {
          font-size: 14px;
          font-weight: 600;
          margin: 0 0 8px;
        }

        .section-hint {
          color: var(--text-muted);
          font-size: 13px;
          margin: 0 0 16px;
        }

        .terms-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .term-toggle {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 16px;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 8px;
          cursor: pointer;
          transition: background 0.15s ease;
        }

        .term-toggle:hover {
          background: var(--bg-hover);
        }

        .term-info {
          flex: 1;
        }

        .term-label {
          display: block;
          font-weight: 500;
          font-size: 14px;
        }

        .term-desc {
          display: block;
          font-size: 12px;
          color: var(--text-muted);
          margin-top: 4px;
        }

        .toggle {
          width: 44px;
          height: 24px;
          appearance: none;
          background: var(--border);
          border-radius: 12px;
          position: relative;
          cursor: pointer;
          transition: background 0.2s ease;
        }

        .toggle::before {
          content: '';
          position: absolute;
          top: 2px;
          left: 2px;
          width: 20px;
          height: 20px;
          background: white;
          border-radius: 50%;
          transition: transform 0.2s ease;
        }

        .toggle:checked {
          background: var(--primary);
        }

        .toggle:checked::before {
          transform: translateX(20px);
        }

        .dispute-options {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .dispute-option {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          padding: 16px;
          background: var(--bg);
          border: 2px solid var(--border);
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .dispute-option:hover {
          border-color: var(--primary);
        }

        .dispute-option.active {
          border-color: var(--primary);
          background: rgba(var(--primary-rgb), 0.05);
        }

        .dispute-option input {
          margin-top: 2px;
        }

        .dispute-label {
          display: block;
          font-weight: 500;
          font-size: 14px;
        }

        .dispute-desc {
          display: block;
          font-size: 12px;
          color: var(--text-muted);
          margin-top: 4px;
        }
      `})]})}function Wi({risks:t,onFinalize:n,isProcessing:i=!1,className:s}){const{watch:c}=Y(),{setStep:l,engagementType:r,engagementCategory:d,primaryLanguage:u}=q(),p=c(),a=Gt(t),N=We(t),S=(b,k)=>{if(b===void 0||b===0)return"—";const E=b/100;return new Intl.NumberFormat("en-US",{style:"currency",currency:k||"USD"}).format(E)},v=({stepIndex:b,label:k,children:E})=>e.jsxs("button",{type:"button",className:"section-link",onClick:()=>l(b),children:[e.jsxs("div",{className:"section-link-header",children:[e.jsxs("span",{className:"section-link-step",children:["Step ",b+1]}),e.jsx("span",{className:"section-link-label",children:k||oe[b]}),e.jsx("span",{className:"section-link-edit",children:"Edit"})]}),e.jsx("div",{className:"section-link-content",children:E})]});return e.jsxs("div",{className:C("wizard-step-content review-step",s),children:[e.jsxs("div",{className:"step-header",children:[e.jsx("h2",{className:"step-title",children:"Review & Finalize"}),e.jsx("p",{className:"step-description",children:"Review your engagement agreement before exporting."})]}),e.jsx("div",{className:"review-section",children:e.jsx(Ge,{risks:t})}),e.jsxs("div",{className:"review-cards",children:[e.jsxs(v,{stepIndex:0,label:"Client & Type",children:[e.jsxs("div",{className:"review-item",children:[e.jsx("span",{className:"review-label",children:"Client"}),e.jsx("span",{className:"review-value",children:p.clientName||"—"})]}),p.projectName&&e.jsxs("div",{className:"review-item",children:[e.jsx("span",{className:"review-label",children:"Project"}),e.jsx("span",{className:"review-value",children:p.projectName})]}),e.jsxs("div",{className:"review-item",children:[e.jsx("span",{className:"review-label",children:"Type"}),e.jsxs("span",{className:"review-value",children:[r==="task"?"Task-Based":"Retainer"," • ",d]})]}),e.jsxs("div",{className:"review-item",children:[e.jsx("span",{className:"review-label",children:"Language"}),e.jsx("span",{className:"review-value",children:u==="ar"?"Arabic":"English"})]})]}),e.jsxs(v,{stepIndex:1,label:"Summary",children:[e.jsxs("div",{className:"review-item",children:[e.jsx("span",{className:"review-label",children:"Title"}),e.jsx("span",{className:"review-value",children:p.title||"—"})]}),p.summary&&e.jsx("div",{className:"review-item",children:e.jsx("span",{className:"review-value review-text",children:p.summary})})]}),e.jsxs(v,{stepIndex:2,label:"Scope",children:[e.jsxs("div",{className:"review-item",children:[e.jsx("span",{className:"review-label",children:"Deliverables"}),e.jsxs("span",{className:"review-value",children:[p.deliverables?.length||0," items"]})]}),e.jsxs("div",{className:"review-item",children:[e.jsx("span",{className:"review-label",children:"Exclusions"}),e.jsxs("span",{className:"review-value",children:[p.exclusions?.length||0," items"]})]}),e.jsxs("div",{className:"review-item",children:[e.jsx("span",{className:"review-label",children:"Dependencies"}),e.jsxs("span",{className:"review-value",children:[p.dependencies?.length||0," items"]})]})]}),e.jsxs(v,{stepIndex:3,label:"Timeline",children:[e.jsxs("div",{className:"review-item",children:[e.jsx("span",{className:"review-label",children:"Start"}),e.jsx("span",{className:"review-value",children:p.startDate?new Date(p.startDate).toLocaleDateString():"—"})]}),e.jsxs("div",{className:"review-item",children:[e.jsx("span",{className:"review-label",children:"End"}),e.jsx("span",{className:"review-value",children:p.endDate?new Date(p.endDate).toLocaleDateString():"—"})]}),e.jsxs("div",{className:"review-item",children:[e.jsx("span",{className:"review-label",children:"Milestones"}),e.jsx("span",{className:"review-value",children:p.milestones?.length||0})]}),e.jsxs("div",{className:"review-item",children:[e.jsx("span",{className:"review-label",children:"Review Window"}),e.jsxs("span",{className:"review-value",children:[p.reviewWindowDays||0," days"]})]})]}),e.jsxs(v,{stepIndex:5,label:"Payment",children:[r==="task"?e.jsxs(e.Fragment,{children:[e.jsxs("div",{className:"review-item",children:[e.jsx("span",{className:"review-label",children:"Total"}),e.jsx("span",{className:"review-value",children:S(p.totalAmountMinor,p.currency)})]}),e.jsxs("div",{className:"review-item",children:[e.jsx("span",{className:"review-label",children:"Deposit"}),e.jsxs("span",{className:"review-value",children:[p.depositPercent||0,"%"]})]}),e.jsxs("div",{className:"review-item",children:[e.jsx("span",{className:"review-label",children:"Payments"}),e.jsxs("span",{className:"review-value",children:[p.scheduleItems?.length||0," scheduled"]})]})]}):e.jsxs(e.Fragment,{children:[e.jsxs("div",{className:"review-item",children:[e.jsx("span",{className:"review-label",children:"Monthly"}),e.jsx("span",{className:"review-value",children:S(p.retainerAmountMinor,p.currency)})]}),e.jsxs("div",{className:"review-item",children:[e.jsx("span",{className:"review-label",children:"Billing Day"}),e.jsx("span",{className:"review-value",children:p.billingDay||1})]})]}),e.jsxs("div",{className:"review-item",children:[e.jsx("span",{className:"review-label",children:"Late Fee"}),e.jsx("span",{className:"review-value",children:p.lateFeeEnabled?"Enabled":"Disabled"})]})]}),e.jsxs(v,{stepIndex:6,label:"Relationship",children:[e.jsxs("div",{className:"review-item",children:[e.jsx("span",{className:"review-label",children:"Term"}),e.jsx("span",{className:"review-value",children:p.termType==="month-to-month"?"Month-to-Month":"Fixed"})]}),e.jsxs("div",{className:"review-item",children:[e.jsx("span",{className:"review-label",children:"Notice Period"}),e.jsxs("span",{className:"review-value",children:[p.terminationNoticeDays||0," days"]})]}),e.jsxs("div",{className:"review-item",children:[e.jsx("span",{className:"review-label",children:"Ownership"}),e.jsx("span",{className:"review-value",children:p.ownershipTransferRule?.replace(/_/g," ")||"—"})]})]}),e.jsxs(v,{stepIndex:7,label:"Terms",children:[e.jsxs("div",{className:"review-terms-badges",children:[p.confidentiality&&e.jsx("span",{className:"term-badge",children:"Confidentiality"}),p.ipOwnership&&e.jsx("span",{className:"term-badge",children:"IP Ownership"}),p.warrantyDisclaimer&&e.jsx("span",{className:"term-badge",children:"Warranty"}),p.limitationOfLiability&&e.jsx("span",{className:"term-badge",children:"Liability Limit"}),p.nonSolicitation&&e.jsx("span",{className:"term-badge",children:"Non-Solicitation"})]}),e.jsxs("div",{className:"review-item",children:[e.jsx("span",{className:"review-label",children:"Disputes"}),e.jsx("span",{className:"review-value",children:p.disputePath||"—"})]})]})]}),e.jsxs("div",{className:"finalize-section",children:[a&&e.jsxs("div",{className:"warning-banner",children:[e.jsx("svg",{viewBox:"0 0 20 20",fill:"currentColor",width:"20",height:"20",children:e.jsx("path",{fillRule:"evenodd",d:"M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z",clipRule:"evenodd"})}),e.jsxs("span",{children:["You have ",N.high," high-severity ",N.high===1?"issue":"issues","that should be addressed before finalizing."]})]}),e.jsx("button",{type:"button",className:"btn btn-primary btn-lg finalize-btn",onClick:n,disabled:i,children:i?"Processing...":"Finalize & Export PDF"}),e.jsx("p",{className:"finalize-hint",children:"Finalizing will create a locked version of this engagement that cannot be edited."})]}),e.jsx("style",{children:`
        .review-step {
          max-width: 800px;
        }

        .step-header {
          margin-bottom: 24px;
        }

        .step-title {
          font-size: 20px;
          font-weight: 600;
          margin: 0 0 8px;
        }

        .step-description {
          color: var(--text-muted);
          margin: 0;
          font-size: 14px;
        }

        .review-section {
          margin-bottom: 24px;
        }

        .review-cards {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 12px;
          margin-bottom: 32px;
        }

        .section-link {
          display: block;
          width: 100%;
          padding: 16px;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 8px;
          text-align: left;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .section-link:hover {
          border-color: var(--primary);
          background: var(--bg-hover);
        }

        .section-link-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 12px;
        }

        .section-link-step {
          font-size: 11px;
          color: var(--text-muted);
          padding: 2px 6px;
          background: var(--bg-elevated);
          border-radius: 4px;
        }

        .section-link-label {
          font-weight: 500;
          font-size: 14px;
          flex: 1;
        }

        .section-link-edit {
          font-size: 12px;
          color: var(--primary);
          opacity: 0;
          transition: opacity 0.15s ease;
        }

        .section-link:hover .section-link-edit {
          opacity: 1;
        }

        .section-link-content {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .review-item {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
          font-size: 13px;
        }

        .review-label {
          color: var(--text-muted);
          flex-shrink: 0;
        }

        .review-value {
          text-align: right;
          word-break: break-word;
        }

        .review-text {
          text-align: left;
          color: var(--text-muted);
          font-size: 12px;
          line-height: 1.4;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .review-terms-badges {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          margin-bottom: 8px;
        }

        .term-badge {
          font-size: 10px;
          padding: 2px 6px;
          background: var(--bg-elevated);
          border-radius: 4px;
          color: var(--text-muted);
        }

        .finalize-section {
          text-align: center;
          padding: 24px;
          background: var(--bg-elevated);
          border-radius: 12px;
          border: 1px solid var(--border);
        }

        .warning-banner {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 12px 16px;
          background: rgba(245, 158, 11, 0.1);
          border: 1px solid var(--warning);
          border-radius: 8px;
          margin-bottom: 16px;
          font-size: 13px;
          color: var(--warning);
        }

        .finalize-btn {
          min-width: 200px;
        }

        .finalize-hint {
          margin: 12px 0 0;
          font-size: 12px;
          color: var(--text-muted);
        }
      `})]})}const Gi=de({profileId:T().min(1,"Profile is required"),profileName:T(),clientId:T().min(1,"Client is required"),clientName:T(),projectId:T().optional(),projectName:T().optional(),title:T().min(1,"Title is required"),summary:T(),clientGoal:T().optional(),deliverables:J(de({id:T(),description:T(),quantity:_().optional(),format:T().optional()})),exclusions:J(T()),dependencies:J(T()),startDate:T().optional(),endDate:T().optional(),milestones:J(de({id:T(),title:T(),targetDate:T().optional(),deliverableIds:J(T())})),reviewWindowDays:_(),silenceEqualsApproval:X(),revisionRounds:_(),revisionDefinition:J(T()),bugFixDays:_().optional(),changeRequestRule:X(),scopeCategories:J(T()).optional(),monthlyCapacity:T().optional(),responseTimeDays:_().optional(),currency:te(["USD","ILS","EUR"]),totalAmountMinor:_().optional(),depositPercent:_().optional(),scheduleItems:J(de({id:T(),label:T(),trigger:te(["on_signing","on_milestone","on_completion","monthly"]),milestoneId:T().optional(),amountMinor:_(),currency:te(["USD","ILS","EUR"])})),lateFeeEnabled:X(),retainerAmountMinor:_().optional(),billingDay:_().optional(),rolloverRule:te(["none","carry","expire"]).optional(),outOfScopeRateMinor:_().optional(),termType:te(["fixed","month-to-month"]),terminationNoticeDays:_(),cancellationCoveragePercent:_().optional(),ownershipTransferRule:T(),confidentiality:X(),ipOwnership:X(),warrantyDisclaimer:X(),limitationOfLiability:X(),nonSolicitation:X(),disputePath:te(["negotiation","mediation","arbitration"]),governingLaw:T().optional()});function sn(){const t=$e({strict:!1}),n=Ye({strict:!1}),i=ye(),s=t.engagementId,c=!!s,{currentStep:l,mode:r,engagementType:d,engagementCategory:u,primaryLanguage:p,isDirty:a,isSaving:N,setDirty:S,setLastSavedAt:v,setIsSaving:b,setPrefill:k,initializeForEdit:E,reset:A,setEngagementId:L}=q(),{data:h}=mt(s||""),{data:m}=Be(s||""),{data:w=[]}=he(),{data:D=[]}=ue(),B=ht(),M=ft(),H=yt(),{showToast:V}=Oe(),Q=ot({resolver:tt(Gi),defaultValues:Re,mode:"onChange"}),{watch:j,reset:g,setValue:y}=Q,P=j(),K=Ut(P,d,u),Z=I.useMemo(()=>w.find(R=>R.id===P.clientId),[w,P.clientId]),$=I.useMemo(()=>D.find(R=>R.id===P.profileId),[D,P.profileId]);Bt(s,P,a,v),I.useEffect(()=>{if(!c){const R=Ue();if(R&&!R.engagementId&&_t())g({...Re,...R.snapshot}),S(!0);else{if(n.profileId&&k({profileId:n.profileId}),n.clientId){const ee=w.find(Ee=>Ee.id===n.clientId);ee&&(y("clientId",ee.id),y("clientName",ee.name))}n.type&&k({type:n.type})}}},[c,n,w,g,y,k,S]),I.useEffect(()=>{c&&h&&m&&(E({engagementId:h.id,type:h.type,category:h.category,language:h.primaryLanguage}),g(m.snapshot))},[c,h,m,E,g]),I.useEffect(()=>{const R=j(()=>{a||S(!0)});return()=>R.unsubscribe()},[j,a,S]);const U=async()=>{b(!0);try{let R=s;R||(R=(await B.mutateAsync({profileId:P.profileId,clientId:P.clientId,projectId:P.projectId,type:d,category:u,primaryLanguage:p,status:"draft"})).id,L(R),window.history.replaceState({},"",`/engagements/${R}/edit`)),await M.mutateAsync({engagementId:R,snapshot:P,status:"draft"}),S(!1),v(new Date().toISOString()),Pe()}catch(R){console.error("Failed to save draft:",R)}finally{b(!1)}},Ce=async()=>{b(!0);try{let R=s;R||(R=(await B.mutateAsync({profileId:P.profileId,clientId:P.clientId,projectId:P.projectId,type:d,category:u,primaryLanguage:p,status:"draft"})).id),await H.mutateAsync({engagementId:R,snapshot:P});const ee=await _e({snapshot:P,client:Z,language:p,type:d,category:u,profile:$});ee.success?(Pe(),V("Engagement finalized and PDF downloaded"),i({to:"/engagements"})):(console.error("PDF generation failed:",ee.error),V("Engagement saved but PDF download failed. Please try downloading again."))}catch(R){console.error("Failed to finalize:",R),V("Failed to finalize engagement. Please try again.")}finally{b(!1)}},Ke=()=>{switch(l){case 0:return e.jsx(Jt,{});case 1:return e.jsx(Zt,{});case 2:return e.jsx(wi,{});case 3:return e.jsx(Ci,{});case 4:return e.jsx(Di,{});case 5:return e.jsx(Fi,{});case 6:return e.jsx(Bi,{});case 7:return e.jsx(Ui,{});case 8:return e.jsx(Wi,{risks:K,onFinalize:Ce,isProcessing:N});default:return null}};return e.jsxs(e.Fragment,{children:[e.jsx(Fe,{title:c?"Edit Engagement":"New Engagement",breadcrumbs:[{label:"Engagements",href:"/engagements"},{label:c?"Edit":"New"}]}),e.jsx("div",{className:"page-content",children:e.jsx(lt,{...Q,children:e.jsxs("form",{onSubmit:R=>R.preventDefault(),children:[e.jsx(Ht,{risks:K}),e.jsxs("div",{className:"wizard-layout",children:[e.jsxs("div",{className:"wizard-form",children:[Ke(),l<8&&e.jsx(Qt,{onSaveDraft:U,onFinalize:Ce,isSaving:N,isValid:!0})]}),e.jsxs("div",{className:"wizard-sidebar",children:[e.jsxs("div",{className:"sidebar-section",children:[e.jsx("h3",{className:"sidebar-title",children:"Clarity Check"}),e.jsx(Ge,{risks:K})]}),e.jsxs("div",{className:"sidebar-section preview-section",children:[e.jsx("h3",{className:"sidebar-title",children:"Preview"}),e.jsx("div",{className:"preview-container",children:e.jsx(Kt,{snapshot:P,client:Z,language:p})})]})]})]})]})})}),e.jsx("style",{children:`
        .wizard-layout {
          display: grid;
          grid-template-columns: 1fr;
          gap: 24px;
        }

        @media (min-width: 1200px) {
          .wizard-layout {
            grid-template-columns: 1fr 400px;
          }
        }

        .wizard-form {
          min-width: 0;
        }

        .wizard-sidebar {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .sidebar-section {
          background: var(--bg-elevated);
          border-radius: 8px;
          overflow: hidden;
        }

        .sidebar-title {
          font-size: 13px;
          font-weight: 600;
          padding: 12px 16px;
          margin: 0;
          border-bottom: 1px solid var(--border);
          background: var(--bg);
        }

        .preview-section {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-height: 400px;
        }

        .preview-container {
          flex: 1;
          overflow: hidden;
          background: white;
        }

        @media (max-width: 1199px) {
          .wizard-sidebar {
            display: none;
          }
        }
      `})]})}export{sn as EngagementWizardPage,nn as EngagementsPage};
