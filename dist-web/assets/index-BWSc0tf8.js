import{j as e,r as I,a as ye,g as Qe,f as Ke}from"./vendor-router-D4Yqsbqz.js";import{V as L,u as be,a as ze,M as ue,L as he,T as Le,c as C,S as $e,n as Fe,G as Me,aI as Ye,N as Xe,x as Je,U as Q,R as Ze}from"./index-WOWG8CNN.js";/* empty css              */import{E as et}from"./EmptyState-r3axvhwz.js";/* empty css                       */import{b as le,u as se,a as ae}from"./vendor-query-CI0tl4qS.js";import{S as je,D as tt,P as it,V as j,I as nt,T as v,p as st}from"./fonts-B2QO5WSf.js";import{h as $,C as F,f as ne,u as at,F as rt,o as de,c as P,_ as te,d as Y,n as _,e as X}from"./vendor-forms-Bf8hyTk9.js";import"./vendor-react-BdxwsYZ-.js";import"./vendor-db-BMy7eggi.js";import"./_commonjs-dynamic-modules-TDtrdbi3.js";function Ee(){return crypto.randomUUID()}function ie(){return new Date().toISOString()}const G={async list(t={}){const s=await L.engagements.toArray(),i=await L.engagementVersions.toArray(),n=await L.clients.toArray(),m=await L.projects.toArray(),o=await L.businessProfiles.toArray(),a=new Map(n.map(x=>[x.id,x.name])),c=new Map(m.map(x=>[x.id,x.name])),g=new Map(o.map(x=>[x.id,x.name])),p=new Map;i.forEach(x=>{const y=p.get(x.engagementId)||[];y.push(x),p.set(x.engagementId,y)});let r=s.filter(x=>{if(!t.includeArchived&&x.archivedAt||t.profileId&&x.profileId!==t.profileId||t.clientId&&x.clientId!==t.clientId||t.projectId&&x.projectId!==t.projectId||t.type&&x.type!==t.type||t.status&&x.status!==t.status||t.category&&x.category!==t.category)return!1;if(t.search){const y=t.search.toLowerCase(),k=a.get(x.clientId)||"",A=(p.get(x.id)||[]).sort((d,N)=>N.versionNumber-d.versionNumber)[0]?.snapshot?.title||"";if(!(k.toLowerCase().includes(y)||A.toLowerCase().includes(y)))return!1}return!0});const w=t.sort?.by||"createdAt",S=t.sort?.dir||"desc";return r.sort((x,y)=>{const k=x[w],E=y[w],T=k.localeCompare(E);return S==="desc"?-T:T}),t.offset&&(r=r.slice(t.offset)),t.limit&&(r=r.slice(0,t.limit)),r.map(x=>{const y=p.get(x.id)||[],k=y.sort((E,T)=>T.versionNumber-E.versionNumber)[0];return{...x,profileName:g.get(x.profileId),clientName:a.get(x.clientId),projectName:x.projectId?c.get(x.projectId):void 0,title:k?.snapshot?.title,versionCount:y.length,lastVersionAt:k?.createdAt}})},async get(t){return L.engagements.get(t)},async getDisplay(t){const s=await this.get(t);if(!s)return;const i=await L.businessProfiles.get(s.profileId),n=await L.clients.get(s.clientId),m=s.projectId?await L.projects.get(s.projectId):void 0,o=await this.getVersions(t),a=o.sort((c,g)=>g.versionNumber-c.versionNumber)[0];return{...s,profileName:i?.name,clientName:n?.name,projectName:m?.name,title:a?.snapshot?.title,versionCount:o.length,lastVersionAt:a?.createdAt}},async create(t){const s=ie(),i={...t,id:Ee(),createdAt:s,updatedAt:s};return await L.engagements.add(i),i},async update(t,s){await L.engagements.update(t,{...s,updatedAt:ie()})},async archive(t){await L.engagements.update(t,{archivedAt:ie(),updatedAt:ie(),status:"archived"})},async restore(t){await L.engagements.update(t,{archivedAt:void 0,updatedAt:ie(),status:"draft"})},async delete(t){const s=await this.getVersions(t);for(const i of s)await L.engagementVersions.delete(i.id);await L.engagements.delete(t)},async getVersions(t){return L.engagementVersions.where("engagementId").equals(t).toArray()},async getVersion(t){return L.engagementVersions.get(t)},async getLatestVersion(t){const s=await this.getVersions(t);if(s.length!==0)return s.sort((i,n)=>n.versionNumber-i.versionNumber)[0]},async saveVersion(t,s,i="draft"){const n=ie(),m=await this.getVersions(t),o=m.length>0?Math.max(...m.map(c=>c.versionNumber)):0,a={id:Ee(),engagementId:t,versionNumber:o+1,status:i,snapshot:s,createdAt:n};return await L.engagementVersions.add(a),await this.update(t,{currentVersionId:a.id}),a},async finalize(t,s){const i=await this.saveVersion(t,s,"final");return await this.update(t,{status:"final",currentVersionId:i.id}),i},async duplicate(t,s,i){const n=await this.get(t);if(!n)throw new Error("Engagement not found");const m=await this.getLatestVersion(t);if(!m)throw new Error("No version found");const o=i||n.profileId,a=await L.businessProfiles.get(o),c=await this.create({profileId:o,clientId:s||n.clientId,projectId:void 0,type:n.type,category:n.category,primaryLanguage:n.primaryLanguage,status:"draft"}),g={...m.snapshot,profileId:o,profileName:a?.name||"",clientId:s||n.clientId,projectId:void 0,projectName:void 0};return await this.saveVersion(c.id,g,"draft"),c},async getByProfile(t){return this.list({profileId:t})},async getByClient(t){return this.list({clientId:t})},async getByProject(t){return this.list({projectId:t})},async countByStatus(){const t=await L.engagements.toArray(),s={draft:0,final:0,archived:0};for(const i of t)s[i.status]++;return s}},ce={engagements:t=>["engagements",t],engagement:t=>["engagement",t],engagementDisplay:t=>["engagementDisplay",t],engagementVersions:t=>["engagementVersions",t],engagementVersion:t=>["engagementVersion",t],latestVersion:t=>["latestVersion",t],countByStatus:()=>["engagementCountByStatus"],byProfile:t=>["engagementsByProfile",t],byClient:t=>["engagementsByClient",t],byProject:t=>["engagementsByProject",t]};function ge(t){t.invalidateQueries({queryKey:["engagements"]}),t.invalidateQueries({queryKey:["engagement"]}),t.invalidateQueries({queryKey:["engagementDisplay"]}),t.invalidateQueries({queryKey:["engagementCountByStatus"]}),t.invalidateQueries({queryKey:["engagementsByProfile"]}),t.invalidateQueries({queryKey:["engagementsByClient"]}),t.invalidateQueries({queryKey:["engagementsByProject"]})}function ot(t){t.invalidateQueries({queryKey:["engagementVersions"]}),t.invalidateQueries({queryKey:["engagementVersion"]}),t.invalidateQueries({queryKey:["latestVersion"]})}function we(t){ge(t),ot(t)}function lt(t={}){return le({queryKey:ce.engagements(t),queryFn:()=>G.list(t)})}function ct(t){return le({queryKey:ce.engagement(t),queryFn:()=>G.get(t),enabled:!!t})}function dt(t){return le({queryKey:ce.engagementDisplay(t),queryFn:()=>G.getDisplay(t),enabled:!!t})}function mt(){return le({queryKey:ce.countByStatus(),queryFn:()=>G.countByStatus()})}function Oe(t){return le({queryKey:ce.latestVersion(t),queryFn:()=>G.getLatestVersion(t),enabled:!!t})}function pt(){const t=se();return ae({mutationFn:s=>G.create(s),onSuccess:()=>ge(t)})}function ut(){const t=se();return ae({mutationFn:s=>G.archive(s),onSuccess:()=>ge(t)})}function ht(){const t=se();return ae({mutationFn:s=>G.restore(s),onSuccess:()=>ge(t)})}function gt(){const t=se();return ae({mutationFn:({id:s,newClientId:i})=>G.duplicate(s,i),onSuccess:()=>we(t)})}function xt(){const t=se();return ae({mutationFn:({engagementId:s,snapshot:i,status:n="draft"})=>G.saveVersion(s,i,n),onSuccess:()=>we(t)})}function vt(){const t=se();return ae({mutationFn:({engagementId:s,snapshot:i})=>G.finalize(s,i),onSuccess:()=>we(t)})}const ft={engagementAgreement:"Engagement Agreement",taskEngagement:"Task-Based Engagement",retainerEngagement:"Retainer Engagement",provider:"Provider",client:"Client",summary:"Summary",scope:"Scope of Work",deliverables:"Deliverables",exclusions:"Exclusions",dependencies:"Dependencies",timeline:"Timeline",startDate:"Start Date",endDate:"End Date",milestones:"Milestones",reviewWindow:"Review Window",reviews:"Reviews & Revisions",revisionRounds:"Revision Rounds",revisionDefinition:"Revision Definition",bugFixPeriod:"Bug Fix Period",payment:"Payment Terms",totalAmount:"Total Amount",deposit:"Deposit",paymentSchedule:"Payment Schedule",lateFee:"Late Payment Fee",retainerAmount:"Monthly Retainer",billingDay:"Billing Day",rollover:"Rollover Rule",outOfScopeRate:"Out-of-Scope Rate",relationship:"Relationship Terms",termType:"Term Type",terminationNotice:"Termination Notice",cancellationCoverage:"Cancellation Coverage",ownershipTransfer:"Ownership Transfer",terms:"Standard Terms",confidentiality:"Confidentiality",ipOwnership:"IP Ownership",warranty:"Warranty Disclaimer",liabilityLimit:"Limitation of Liability",nonSolicitation:"Non-Solicitation",disputeResolution:"Dispute Resolution",governingLaw:"Governing Law",signatures:"Signatures",days:"days",rounds:"rounds",percent:"%",enabled:"Enabled",disabled:"Disabled",fixed:"Fixed Term",monthToMonth:"Month-to-Month",negotiation:"Good Faith Negotiation",mediation:"Mediation",arbitration:"Binding Arbitration",noRollover:"No Rollover",carryForward:"Carry Forward",useOrLose:"Use or Lose",onSigning:"On Signing",onMilestone:"On Milestone",onCompletion:"On Completion",monthly:"Monthly",design:"Design",development:"Development",consulting:"Consulting",marketing:"Marketing",legal:"Legal",other:"Other",legalTerms:"Terms and Conditions",generatedBy:"Generated by Mutaba3a",page:"Page",of:"of"},yt={engagementAgreement:"اتفاقية العمل",taskEngagement:"عمل قائم على المهام",retainerEngagement:"عقد شهري",provider:"مقدم الخدمة",client:"العميل",summary:"الملخص",scope:"نطاق العمل",deliverables:"التسليمات",exclusions:"الاستثناءات",dependencies:"المتطلبات المسبقة",timeline:"الجدول الزمني",startDate:"تاريخ البدء",endDate:"تاريخ الانتهاء",milestones:"المراحل",reviewWindow:"فترة المراجعة",reviews:"المراجعات والتعديلات",revisionRounds:"جولات التعديل",revisionDefinition:"تعريف التعديل",bugFixPeriod:"فترة إصلاح الأخطاء",payment:"شروط الدفع",totalAmount:"المبلغ الإجمالي",deposit:"الدفعة المقدمة",paymentSchedule:"جدول الدفع",lateFee:"رسوم التأخير",retainerAmount:"المبلغ الشهري",billingDay:"يوم الفوترة",rollover:"قاعدة الترحيل",outOfScopeRate:"سعر العمل الإضافي",relationship:"شروط العلاقة",termType:"نوع المدة",terminationNotice:"إشعار الإنهاء",cancellationCoverage:"تغطية الإلغاء",ownershipTransfer:"نقل الملكية",terms:"الشروط القياسية",confidentiality:"السرية",ipOwnership:"ملكية الفكرية",warranty:"إخلاء الضمان",liabilityLimit:"تحديد المسؤولية",nonSolicitation:"عدم الاستقطاب",disputeResolution:"حل النزاعات",governingLaw:"القانون الحاكم",signatures:"التوقيعات",days:"أيام",rounds:"جولات",percent:"٪",enabled:"مفعل",disabled:"معطل",fixed:"مدة محددة",monthToMonth:"شهر بشهر",negotiation:"التفاوض بحسن نية",mediation:"الوساطة",arbitration:"التحكيم الملزم",noRollover:"بدون ترحيل",carryForward:"ترحيل للأمام",useOrLose:"استخدم أو افقد",onSigning:"عند التوقيع",onMilestone:"عند المرحلة",onCompletion:"عند الإنجاز",monthly:"شهري",design:"تصميم",development:"تطوير",consulting:"استشارات",marketing:"تسويق",legal:"قانوني",other:"أخرى",legalTerms:"الشروط والأحكام",generatedBy:"تم إنشاؤه بواسطة متابعة",page:"صفحة",of:"من"};function Ne(t){return t==="ar"?yt:ft}function bt(t,s){const i=Ne(s);return t==="task"?i.taskEngagement:i.retainerEngagement}function jt(t,s){const i=Ne(s);return{design:i.design,development:i.development,consulting:i.consulting,marketing:i.marketing,legal:i.legal,other:i.other}[t]||i.other}const l=je.create({page:{padding:"20mm",fontSize:11,lineHeight:1.5,backgroundColor:"#ffffff"},header:{marginBottom:20},title:{fontSize:22,fontWeight:700,marginBottom:8},subtitle:{fontSize:12,color:"#666666",marginBottom:4},section:{marginBottom:20},sectionTitle:{fontSize:14,fontWeight:600,marginBottom:10,paddingBottom:4,borderBottomWidth:1,borderBottomColor:"#e0e0e0"},sectionContent:{paddingLeft:0},paragraph:{marginBottom:8,fontSize:11,lineHeight:1.6},list:{marginBottom:8},listItem:{flexDirection:"row",marginBottom:4},listBullet:{width:15,fontSize:11},listContent:{flex:1,fontSize:11},table:{marginBottom:12},tableHeader:{flexDirection:"row",backgroundColor:"#f5f5f5",borderBottomWidth:1,borderBottomColor:"#e0e0e0",paddingVertical:6,paddingHorizontal:8},tableRow:{flexDirection:"row",borderBottomWidth:.5,borderBottomColor:"#e0e0e0",paddingVertical:6,paddingHorizontal:8},tableCell:{fontSize:10},tableCellHeader:{fontSize:10,fontWeight:600},infoRow:{flexDirection:"row",marginBottom:4},infoLabel:{width:120,fontSize:10,color:"#666666"},infoValue:{flex:1,fontSize:10,fontWeight:500},partiesSection:{flexDirection:"row",marginBottom:20,gap:20},partyBox:{flex:1,padding:12,backgroundColor:"#f9f9f9",borderRadius:4},partyTitle:{fontSize:10,color:"#666666",marginBottom:4},partyName:{fontSize:12,fontWeight:600,marginBottom:4},badge:{display:"flex",paddingHorizontal:6,paddingVertical:2,backgroundColor:"#e0e0e0",borderRadius:4,fontSize:9,marginRight:4},badgesRow:{flexDirection:"row",flexWrap:"wrap",gap:4,marginBottom:8},footer:{marginTop:"auto",paddingTop:20,borderTopWidth:1,borderTopColor:"#e0e0e0",fontSize:9,color:"#666666"},signatureSection:{flexDirection:"row",marginTop:40,gap:40},signatureBox:{flex:1},signatureLine:{borderBottomWidth:1,borderBottomColor:"#000000",marginBottom:8,height:40},signatureLabel:{fontSize:10,color:"#666666"},amount:{fontSize:14,fontWeight:600},amountMuted:{fontSize:11,color:"#666666"},legalClausesHeader:{marginTop:20,marginBottom:12,paddingBottom:6,borderBottomWidth:2,borderBottomColor:"#333333"},legalClausesTitle:{fontSize:14,fontWeight:700},legalSection:{marginTop:14,marginBottom:10},legalSectionTitle:{fontSize:11,fontWeight:600,marginBottom:8,color:"#111111"},legalSubsection:{marginBottom:10,marginLeft:0},legalSubsectionTitle:{fontSize:10,fontWeight:600,color:"#333333",marginBottom:3},legalSubsectionContent:{fontSize:9,lineHeight:1.5,textAlign:"justify",color:"#333333"}});function wt(t){return t==="ar"?"IBMPlexSansArabic":"IBMPlexSans"}function Nt(t){return t==="ar"?"right":"left"}const St={version:"1.0.0",sections:[{id:"5",title:"Intellectual Property",toggleKey:"ipOwnership",subsections:[{id:"5.1",title:"Work Product",content:'In this Agreement, "Work Product" means all discoveries, designs, developments, improvements, inventions (whether or not patentable), works of authorship, trade secrets, software, source code, documentation, technical data, and any other works, materials, and deliverables that {serviceprovider}, solely or jointly with others, creates, conceives, develops, or reduces to practice in the performance of the Services.'},{id:"5.2",title:"Assignment of Work Product",content:"Upon full payment of all amounts due under this Agreement, {serviceprovider} hereby irrevocably assigns to {company} all right, title, and interest in and to the Work Product, including all intellectual property rights therein. Until such full payment, {serviceprovider} retains ownership of the Work Product, and {company} shall have no rights to use, modify, or distribute the Work Product."},{id:"5.3",title:"Pre-existing Materials",content:'{serviceprovider} retains all right, title, and interest in any materials, tools, libraries, frameworks, or intellectual property owned by or licensed to {serviceprovider} prior to the Effective Date or developed independently outside the scope of this Agreement ("Pre-existing Materials"). To the extent any Pre-existing Materials are incorporated into the Work Product, {serviceprovider} grants {company} a non-exclusive, royalty-free, perpetual, worldwide license to use such Pre-existing Materials solely as part of the Work Product.'},{id:"5.4",title:"Third-Party Materials",content:"If the Work Product incorporates any third-party materials (including open-source software), {serviceprovider} shall identify such materials and their applicable license terms. {company} agrees to comply with all such third-party license terms. {serviceprovider} makes no representations regarding the suitability of such third-party materials for {company}'s intended use."},{id:"5.5",title:"Moral Rights",content:"To the extent permitted by applicable law, {serviceprovider} waives and agrees not to assert any moral rights in the Work Product, including rights of attribution, integrity, and disclosure."},{id:"5.6",title:"Further Assurances",content:"{serviceprovider} agrees to execute any documents and take any actions reasonably requested by {company} to perfect, register, or enforce {company}'s rights in the Work Product, at {company}'s expense."},{id:"5.7",title:"Portfolio Rights",content:"{serviceprovider} retains the right to display, reference, and describe the Work Product (excluding Confidential Information) in {serviceprovider}'s portfolio, marketing materials, and similar promotional contexts, unless {company} provides written notice to the contrary."}]},{id:"6",title:"Confidentiality",toggleKey:"confidentiality",subsections:[{id:"6.1",title:"Definition",content:'"Confidential Information" means any non-public information disclosed by one party (the "Discloser") to the other party (the "Recipient") in connection with this Agreement, whether oral, written, electronic, or otherwise, that is designated as confidential or that reasonably should be understood to be confidential given the nature of the information and circumstances of disclosure. Confidential Information includes, without limitation, business plans, technical data, trade secrets, customer information, financial information, and proprietary processes.'},{id:"6.2",title:"Obligations",content:"The Recipient shall: (a) hold the Confidential Information in strict confidence; (b) not disclose the Confidential Information to any third party except as expressly permitted herein; (c) use the Confidential Information only for purposes of performing or receiving the Services; and (d) protect the Confidential Information using at least the same degree of care it uses to protect its own confidential information, but in no event less than reasonable care. The Recipient may disclose Confidential Information to its employees, contractors, and advisors who have a need to know and are bound by confidentiality obligations at least as protective as those herein."},{id:"6.3",title:"Exceptions",content:"Confidential Information does not include information that: (a) is or becomes publicly available through no fault of the Recipient; (b) was rightfully known to the Recipient prior to disclosure; (c) is rightfully obtained by the Recipient from a third party without restriction; or (d) is independently developed by the Recipient without use of the Confidential Information. The Recipient may disclose Confidential Information if required by law, provided the Recipient gives the Discloser prompt notice and reasonable assistance to seek a protective order."}]},{id:"7",title:"Ownership and Return of Materials",toggleKey:"confidentiality",subsections:[{id:"7.1",title:"Return of Materials",content:"Upon termination of this Agreement or upon the Discloser's written request, the Recipient shall promptly return or destroy all Confidential Information and any copies thereof, and shall certify in writing that it has done so. Notwithstanding the foregoing, the Recipient may retain copies of Confidential Information to the extent required by applicable law or for legitimate archival purposes, subject to continued confidentiality obligations."}]},{id:"8",title:"Indemnification and Limitation of Liability",toggleKey:"limitationOfLiability",subsections:[{id:"8.1",title:"Mutual Indemnification",content:`Each party (the "Indemnifying Party") agrees to indemnify, defend, and hold harmless the other party and its officers, directors, employees, and agents (collectively, the "Indemnified Parties") from and against any claims, damages, losses, liabilities, costs, and expenses (including reasonable attorneys' fees) arising out of or relating to: (a) the Indemnifying Party's breach of any representation, warranty, or obligation under this Agreement; (b) the Indemnifying Party's negligence or willful misconduct; or (c) any third-party claim that the Indemnifying Party's materials infringe such third party's intellectual property rights.`},{id:"8.2",title:"Limitation of Liability",content:"EXCEPT FOR BREACHES OF CONFIDENTIALITY, INDEMNIFICATION OBLIGATIONS, OR WILLFUL MISCONDUCT, NEITHER PARTY SHALL BE LIABLE TO THE OTHER FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING LOSS OF PROFITS, REVENUE, DATA, OR USE, REGARDLESS OF THE THEORY OF LIABILITY, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES."},{id:"8.3",title:"Liability Cap",content:"EXCEPT FOR BREACHES OF CONFIDENTIALITY, INDEMNIFICATION OBLIGATIONS, OR WILLFUL MISCONDUCT, THE TOTAL AGGREGATE LIABILITY OF EITHER PARTY ARISING OUT OF OR RELATING TO THIS AGREEMENT SHALL NOT EXCEED THE TOTAL AMOUNTS PAID OR PAYABLE BY {company} TO {serviceprovider} UNDER THIS AGREEMENT DURING THE TWELVE (12) MONTHS PRECEDING THE CLAIM."}]},{id:"9",title:"No Conflict of Interest",toggleKey:"nonSolicitation",subsections:[{id:"9.1",title:"Non-Solicitation",content:"During the term of this Agreement and for a period of twelve (12) months thereafter, neither party shall directly or indirectly solicit, recruit, or hire any employee or contractor of the other party who was involved in the performance or receipt of the Services, without the other party's prior written consent. This restriction shall not apply to general employment advertisements or unsolicited applications."},{id:"9.2",title:"No Exclusivity",content:"Unless otherwise expressly agreed in writing, this Agreement does not create an exclusive relationship between the parties. {serviceprovider} is free to provide similar services to other clients, and {company} is free to engage other service providers, provided that such activities do not breach the confidentiality or intellectual property provisions herein."}]},{id:"10",title:"Term and Termination",subsections:[{id:"10.1",title:"Term",content:"This Agreement shall commence on the Effective Date ({effectivedate}) and shall continue until the completion of the Services or {terminationdate}, whichever occurs first, unless earlier terminated in accordance with this Section."},{id:"10.2",title:"Termination for Convenience",content:"Either party may terminate this Agreement for any reason upon {noticeperiod} days' prior written notice to the other party. Upon such termination, {company} shall pay {serviceprovider} for all Services satisfactorily performed through the effective date of termination."},{id:"10.3",title:"Termination for Cause",content:"Either party may terminate this Agreement immediately upon written notice if the other party: (a) materially breaches this Agreement and fails to cure such breach within fifteen (15) days after receiving written notice thereof; (b) becomes insolvent or files or has filed against it a petition in bankruptcy; or (c) ceases to do business in the normal course."},{id:"10.4",title:"Effect of Termination",content:"Upon termination: (a) all licenses granted hereunder shall terminate, except as otherwise provided; (b) each party shall return or destroy the other party's Confidential Information; (c) {company} shall pay all amounts due for Services performed through the termination date; and (d) the provisions of Sections relating to intellectual property (upon full payment), confidentiality, indemnification, limitation of liability, and general provisions shall survive termination."}]},{id:"11",title:"Support and Warranty Period",subsections:[{id:"11.1",title:"Support Period",content:"Following delivery and acceptance of the Work Product, {serviceprovider} shall provide support for a period of {supportperiod} to address any defects or bugs in the Work Product that prevent it from performing materially in accordance with its specifications. This support is limited to fixing defects and does not include enhancements, new features, or changes requested by {company}."},{id:"11.2",title:"Warranty Disclaimer",content:`EXCEPT AS EXPRESSLY SET FORTH IN THIS AGREEMENT, {serviceprovider} PROVIDES THE SERVICES AND WORK PRODUCT "AS IS" AND MAKES NO WARRANTIES, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, OR NON-INFRINGEMENT. {serviceprovider} DOES NOT WARRANT THAT THE SERVICES OR WORK PRODUCT WILL BE ERROR-FREE, UNINTERRUPTED, OR MEET {company}'S SPECIFIC REQUIREMENTS.`}]},{id:"12",title:"General Provisions",subsections:[{id:"12.1",title:"Governing Law",content:"This Agreement shall be governed by and construed in accordance with the laws of {governinglaw}, without regard to its conflicts of law principles. Any disputes arising under or relating to this Agreement shall be resolved in the courts of competent jurisdiction in {governinglaw}."},{id:"12.2",title:"Entire Agreement",content:"This Agreement constitutes the entire agreement between the parties with respect to the subject matter hereof and supersedes all prior and contemporaneous agreements, representations, and understandings, whether written or oral. No modification of this Agreement shall be binding unless in writing and signed by both parties."},{id:"12.3",title:"Severability",content:"If any provision of this Agreement is held to be invalid, illegal, or unenforceable, such provision shall be modified to the minimum extent necessary to make it valid, legal, and enforceable, or if modification is not possible, shall be severed from this Agreement. The remaining provisions shall continue in full force and effect."},{id:"12.4",title:"Waiver",content:"The failure of either party to enforce any right or provision of this Agreement shall not constitute a waiver of such right or provision. Any waiver must be in writing and signed by the waiving party."},{id:"12.5",title:"Assignment",content:"Neither party may assign or transfer this Agreement or any rights or obligations hereunder without the prior written consent of the other party, except that either party may assign this Agreement in connection with a merger, acquisition, or sale of all or substantially all of its assets. This Agreement shall be binding upon and inure to the benefit of the parties and their permitted successors and assigns."},{id:"12.6",title:"Independent Contractor",content:"{serviceprovider} is an independent contractor and not an employee, agent, partner, or joint venturer of {company}. {serviceprovider} shall be solely responsible for all taxes, benefits, and insurance arising from {serviceprovider}'s performance under this Agreement. Nothing in this Agreement shall be construed to create an employment or agency relationship between the parties."},{id:"12.7",title:"Notices",content:"All notices under this Agreement shall be in writing and shall be deemed given when delivered personally, sent by confirmed email, or sent by recognized overnight courier to the addresses set forth in this Agreement or such other address as a party may designate by notice."}]}]},kt={version:"1.0.0",sections:[{id:"5",title:"الملكية الفكرية",toggleKey:"ipOwnership",subsections:[{id:"5.1",title:"نتاج العمل",content:'في هذه الاتفاقية، يُقصد بـ "نتاج العمل" جميع الاكتشافات والتصاميم والتطويرات والتحسينات والاختراعات (سواء كانت قابلة للحماية ببراءة اختراع أم لا) والمصنفات الفكرية والأسرار التجارية والبرمجيات والكود المصدري والوثائق والبيانات التقنية وأي أعمال ومواد ومخرجات أخرى ينشئها أو يبتكرها أو يطورها {serviceprovider} بمفرده أو بالاشتراك مع آخرين في سياق تقديم الخدمات.'},{id:"5.2",title:"التنازل عن نتاج العمل",content:"عند السداد الكامل لجميع المبالغ المستحقة بموجب هذه الاتفاقية، يتنازل {serviceprovider} بموجب هذا بشكل نهائي لصالح {company} عن كافة الحقوق والملكية والمصالح في نتاج العمل، بما في ذلك جميع حقوق الملكية الفكرية المتعلقة به. وحتى يتم السداد الكامل، يحتفظ {serviceprovider} بملكية نتاج العمل، ولا يحق لـ {company} استخدام أو تعديل أو توزيع نتاج العمل."},{id:"5.3",title:"المواد الموجودة مسبقاً",content:'يحتفظ {serviceprovider} بجميع الحقوق والملكية والمصالح في أي مواد أو أدوات أو مكتبات أو إطارات عمل أو ملكية فكرية مملوكة لـ {serviceprovider} أو مرخصة له قبل تاريخ السريان أو مطورة بشكل مستقل خارج نطاق هذه الاتفاقية ("المواد الموجودة مسبقاً"). وبقدر ما يتم دمج أي مواد موجودة مسبقاً في نتاج العمل، يمنح {serviceprovider} لـ {company} ترخيصاً غير حصري وخالٍ من الإتاوات ودائماً وعالمياً لاستخدام هذه المواد الموجودة مسبقاً فقط كجزء من نتاج العمل.'},{id:"5.4",title:"مواد الطرف الثالث",content:"إذا تضمن نتاج العمل أي مواد من طرف ثالث (بما في ذلك البرمجيات مفتوحة المصدر)، يجب على {serviceprovider} تحديد هذه المواد وشروط الترخيص المعمول بها. يوافق {company} على الالتزام بجميع شروط ترخيص الطرف الثالث هذه. لا يقدم {serviceprovider} أي تعهدات بشأن ملاءمة مواد الطرف الثالث هذه للاستخدام المقصود من قبل {company}."},{id:"5.5",title:"الحقوق المعنوية",content:"إلى الحد الذي يسمح به القانون المعمول به، يتنازل {serviceprovider} ويوافق على عدم المطالبة بأي حقوق معنوية في نتاج العمل، بما في ذلك حقوق النسب والسلامة والإفصاح."},{id:"5.6",title:"ضمانات إضافية",content:"يوافق {serviceprovider} على تنفيذ أي مستندات واتخاذ أي إجراءات يطلبها {company} بشكل معقول لإتقان أو تسجيل أو إنفاذ حقوق {company} في نتاج العمل، على نفقة {company}."},{id:"5.7",title:"حقوق المحفظة",content:"يحتفظ {serviceprovider} بالحق في عرض والإشارة إلى ووصف نتاج العمل (باستثناء المعلومات السرية) في محفظة {serviceprovider} والمواد التسويقية والسياقات الترويجية المماثلة، ما لم يقدم {company} إشعاراً كتابياً بخلاف ذلك."}]},{id:"6",title:"السرية",toggleKey:"confidentiality",subsections:[{id:"6.1",title:"التعريف",content:'يُقصد بـ "المعلومات السرية" أي معلومات غير عامة يفصح عنها أحد الطرفين ("المُفصِح") للطرف الآخر ("المُتلقي") فيما يتعلق بهذه الاتفاقية، سواء كانت شفهية أو مكتوبة أو إلكترونية أو غير ذلك، والتي تم تصنيفها على أنها سرية أو التي يجب أن يُفهم بشكل معقول أنها سرية بالنظر إلى طبيعة المعلومات وظروف الإفصاح. تشمل المعلومات السرية، على سبيل المثال لا الحصر، خطط الأعمال والبيانات التقنية والأسرار التجارية ومعلومات العملاء والمعلومات المالية والعمليات الخاصة.'},{id:"6.2",title:"الالتزامات",content:"يجب على المُتلقي: (أ) الحفاظ على المعلومات السرية بسرية تامة؛ (ب) عدم الإفصاح عن المعلومات السرية لأي طرف ثالث إلا بموجب الإذن الصريح في هذه الاتفاقية؛ (ج) استخدام المعلومات السرية فقط لأغراض تنفيذ أو تلقي الخدمات؛ و(د) حماية المعلومات السرية باستخدام نفس درجة العناية على الأقل التي يستخدمها لحماية معلوماته السرية الخاصة، ولكن في جميع الأحوال لا تقل عن العناية المعقولة. يجوز للمُتلقي الإفصاح عن المعلومات السرية لموظفيه ومقاوليه ومستشاريه الذين لديهم حاجة للمعرفة والملتزمين بالتزامات السرية بنفس درجة الحماية على الأقل."},{id:"6.3",title:"الاستثناءات",content:"لا تشمل المعلومات السرية المعلومات التي: (أ) أصبحت أو تصبح متاحة للعموم دون خطأ من المُتلقي؛ (ب) كانت معروفة بشكل مشروع للمُتلقي قبل الإفصاح؛ (ج) حصل عليها المُتلقي بشكل مشروع من طرف ثالث دون قيود؛ أو (د) طورها المُتلقي بشكل مستقل دون استخدام المعلومات السرية. يجوز للمُتلقي الإفصاح عن المعلومات السرية إذا كان ذلك مطلوباً بموجب القانون، شريطة أن يقدم المُتلقي إشعاراً فورياً للمُفصِح ومساعدة معقولة للحصول على أمر حماية."}]},{id:"7",title:"ملكية المواد وإعادتها",toggleKey:"confidentiality",subsections:[{id:"7.1",title:"إعادة المواد",content:"عند إنهاء هذه الاتفاقية أو بناءً على طلب كتابي من المُفصِح، يجب على المُتلقي إعادة أو إتلاف جميع المعلومات السرية وأي نسخ منها على الفور، ويجب أن يُقدم شهادة كتابية بأنه قام بذلك. وبصرف النظر عما سبق، يجوز للمُتلقي الاحتفاظ بنسخ من المعلومات السرية إلى الحد الذي يتطلبه القانون المعمول به أو لأغراض الأرشفة المشروعة، مع مراعاة استمرار التزامات السرية."}]},{id:"8",title:"التعويض وتحديد المسؤولية",toggleKey:"limitationOfLiability",subsections:[{id:"8.1",title:"التعويض المتبادل",content:'يوافق كل طرف ("الطرف المُعوِّض") على تعويض الطرف الآخر ومسؤوليه ومديريه وموظفيه ووكلائه (مجتمعين، "الأطراف المُعوَّضة") والدفاع عنهم وإبراء ذمتهم من وضد أي مطالبات أو أضرار أو خسائر أو التزامات أو تكاليف ونفقات (بما في ذلك أتعاب المحاماة المعقولة) الناشئة عن أو المتعلقة بـ: (أ) إخلال الطرف المُعوِّض بأي تعهد أو ضمان أو التزام بموجب هذه الاتفاقية؛ (ب) إهمال الطرف المُعوِّض أو سوء السلوك المتعمد؛ أو (ج) أي مطالبة من طرف ثالث بأن مواد الطرف المُعوِّض تنتهك حقوق الملكية الفكرية لهذا الطرف الثالث.'},{id:"8.2",title:"تحديد المسؤولية",content:"باستثناء انتهاكات السرية والتزامات التعويض أو سوء السلوك المتعمد، لن يكون أي من الطرفين مسؤولاً تجاه الآخر عن أي أضرار غير مباشرة أو عرضية أو خاصة أو تبعية أو عقابية، بما في ذلك خسارة الأرباح أو الإيرادات أو البيانات أو الاستخدام، بغض النظر عن نظرية المسؤولية، حتى لو تم إبلاغه بإمكانية حدوث مثل هذه الأضرار."},{id:"8.3",title:"سقف المسؤولية",content:"باستثناء انتهاكات السرية والتزامات التعويض أو سوء السلوك المتعمد، لن تتجاوز المسؤولية الإجمالية الكلية لأي من الطرفين الناشئة عن أو المتعلقة بهذه الاتفاقية إجمالي المبالغ المدفوعة أو المستحقة الدفع من قبل {company} لـ {serviceprovider} بموجب هذه الاتفاقية خلال الاثني عشر (12) شهراً السابقة للمطالبة."}]},{id:"9",title:"عدم تعارض المصالح",toggleKey:"nonSolicitation",subsections:[{id:"9.1",title:"عدم الاستقطاب",content:"خلال مدة هذه الاتفاقية ولفترة اثني عشر (12) شهراً بعدها، لا يجوز لأي من الطرفين بشكل مباشر أو غير مباشر استقطاب أو توظيف أو تعيين أي موظف أو مقاول لدى الطرف الآخر كان مشاركاً في تنفيذ أو تلقي الخدمات، دون موافقة كتابية مسبقة من الطرف الآخر. لا ينطبق هذا القيد على إعلانات التوظيف العامة أو الطلبات غير المطلوبة."},{id:"9.2",title:"عدم الحصرية",content:"ما لم يُتفق على خلاف ذلك صراحةً بالكتابة، لا تُنشئ هذه الاتفاقية علاقة حصرية بين الطرفين. يحق لـ {serviceprovider} تقديم خدمات مماثلة لعملاء آخرين، ويحق لـ {company} التعاقد مع مقدمي خدمات آخرين، شريطة ألا تنتهك هذه الأنشطة أحكام السرية أو الملكية الفكرية الواردة في هذه الاتفاقية."}]},{id:"10",title:"المدة والإنهاء",subsections:[{id:"10.1",title:"المدة",content:"تبدأ هذه الاتفاقية من تاريخ السريان ({effectivedate}) وتستمر حتى إتمام الخدمات أو {terminationdate}، أيهما يحدث أولاً، ما لم يتم إنهاؤها مبكراً وفقاً لهذا البند."},{id:"10.2",title:"الإنهاء للراحة",content:"يجوز لأي من الطرفين إنهاء هذه الاتفاقية لأي سبب بموجب إشعار كتابي مسبق قبل {noticeperiod} يوماً للطرف الآخر. عند هذا الإنهاء، يجب على {company} دفع مقابل جميع الخدمات المُنجزة بشكل مُرضٍ حتى تاريخ سريان الإنهاء."},{id:"10.3",title:"الإنهاء لسبب",content:"يجوز لأي من الطرفين إنهاء هذه الاتفاقية فوراً بموجب إشعار كتابي إذا: (أ) أخل الطرف الآخر إخلالاً جوهرياً بهذه الاتفاقية وفشل في معالجة هذا الإخلال خلال خمسة عشر (15) يوماً من تلقي إشعار كتابي بذلك؛ (ب) أصبح الطرف الآخر معسراً أو قدم أو قُدم ضده طلب إفلاس؛ أو (ج) توقف الطرف الآخر عن ممارسة أعماله بالطريقة المعتادة."},{id:"10.4",title:"أثر الإنهاء",content:"عند الإنهاء: (أ) تنتهي جميع التراخيص الممنوحة بموجب هذه الاتفاقية، إلا بموجب ما هو منصوص عليه خلافاً لذلك؛ (ب) يجب على كل طرف إعادة أو إتلاف المعلومات السرية للطرف الآخر؛ (ج) يجب على {company} دفع جميع المبالغ المستحقة مقابل الخدمات المُنجزة حتى تاريخ الإنهاء؛ و(د) تظل الأحكام المتعلقة بالملكية الفكرية (عند السداد الكامل) والسرية والتعويض وتحديد المسؤولية والأحكام العامة سارية بعد الإنهاء."}]},{id:"11",title:"الدعم وفترة الضمان",subsections:[{id:"11.1",title:"فترة الدعم",content:"بعد تسليم نتاج العمل وقبوله، يجب على {serviceprovider} تقديم الدعم لفترة {supportperiod} لمعالجة أي عيوب أو أخطاء في نتاج العمل تمنعه من الأداء بشكل جوهري وفقاً لمواصفاته. يقتصر هذا الدعم على إصلاح العيوب ولا يشمل التحسينات أو الميزات الجديدة أو التغييرات التي يطلبها {company}."},{id:"11.2",title:"إخلاء الضمان",content:'باستثناء ما هو منصوص عليه صراحةً في هذه الاتفاقية، يُقدم {serviceprovider} الخدمات ونتاج العمل "كما هي" ولا يُقدم أي ضمانات صريحة أو ضمنية، بما في ذلك على سبيل المثال لا الحصر الضمانات الضمنية للرواج أو الملاءمة لغرض معين أو الملكية أو عدم الانتهاك. لا يضمن {serviceprovider} أن الخدمات أو نتاج العمل ستكون خالية من الأخطاء أو دون انقطاع أو تلبي المتطلبات المحددة لـ {company}.'}]},{id:"12",title:"الأحكام العامة",subsections:[{id:"12.1",title:"القانون الحاكم",content:"تخضع هذه الاتفاقية وتُفسر وفقاً لقوانين {governinglaw}، دون مراعاة مبادئ تعارض القوانين. يتم حل أي نزاعات ناشئة بموجب أو متعلقة بهذه الاتفاقية في المحاكم ذات الاختصاص القضائي في {governinglaw}."},{id:"12.2",title:"الاتفاقية الكاملة",content:"تُشكل هذه الاتفاقية الاتفاقية الكاملة بين الطرفين فيما يتعلق بالموضوع الوارد فيها وتحل محل جميع الاتفاقيات والتعهدات والتفاهمات السابقة والمعاصرة، سواء كانت مكتوبة أو شفهية. لا يكون أي تعديل على هذه الاتفاقية ملزماً ما لم يكن كتابياً وموقعاً من كلا الطرفين."},{id:"12.3",title:"قابلية الفصل",content:"إذا تم اعتبار أي حكم من أحكام هذه الاتفاقية باطلاً أو غير قانوني أو غير قابل للتنفيذ، يتم تعديل هذا الحكم إلى الحد الأدنى اللازم لجعله صالحاً وقانونياً وقابلاً للتنفيذ، أو إذا لم يكن التعديل ممكناً، يتم فصله عن هذه الاتفاقية. تظل الأحكام المتبقية سارية المفعول بالكامل."},{id:"12.4",title:"التنازل",content:"لا يُشكل عدم قيام أي من الطرفين بإنفاذ أي حق أو حكم من أحكام هذه الاتفاقية تنازلاً عن هذا الحق أو الحكم. يجب أن يكون أي تنازل كتابياً وموقعاً من الطرف المتنازل."},{id:"12.5",title:"التنازل عن الاتفاقية",content:"لا يجوز لأي من الطرفين التنازل عن هذه الاتفاقية أو نقلها أو أي حقوق أو التزامات بموجبها دون موافقة كتابية مسبقة من الطرف الآخر، باستثناء أنه يجوز لأي من الطرفين التنازل عن هذه الاتفاقية فيما يتعلق بالاندماج أو الاستحواذ أو بيع جميع أصوله أو معظمها. تكون هذه الاتفاقية ملزمة ونافذة لصالح الطرفين وخلفائهم والمتنازل لهم المصرح بهم."},{id:"12.6",title:"المقاول المستقل",content:"{serviceprovider} هو مقاول مستقل وليس موظفاً أو وكيلاً أو شريكاً أو متعاقداً مشتركاً لـ {company}. يكون {serviceprovider} وحده مسؤولاً عن جميع الضرائب والمزايا والتأمينات الناشئة عن أداء {serviceprovider} بموجب هذه الاتفاقية. لا يجوز تفسير أي شيء في هذه الاتفاقية على أنه ينشئ علاقة توظيف أو وكالة بين الطرفين."},{id:"12.7",title:"الإشعارات",content:"يجب أن تكون جميع الإشعارات بموجب هذه الاتفاقية كتابية وتُعتبر مُقدمة عند تسليمها شخصياً أو إرسالها بالبريد الإلكتروني المؤكد أو إرسالها بواسطة شركة بريد معترف بها إلى العناوين المحددة في هذه الاتفاقية أو أي عنوان آخر قد يحدده أي طرف بموجب إشعار."}]}]};function De(t){return t?new Date(t).toLocaleDateString("en-GB",{day:"2-digit",month:"long",year:"numeric"}):"_______________"}function Ct(t){return{serviceprovider:t.profileName||"Service Provider",company:t.clientName||"Client",effectivedate:De(t.startDate),terminationdate:De(t.endDate),noticeperiod:String(t.terminationNoticeDays||14),governinglaw:t.governingLaw||"the applicable jurisdiction",supportperiod:"six (6) months"}}function xe(t,s){return Object.entries(s).reduce((i,[n,m])=>i.replace(new RegExp(`\\{${n}\\}`,"gi"),String(m??"")),t)}function Et(t){return t==="ar"?kt:St}function Dt(t,s){return t.sections.filter(i=>i.toggleKey?!!s[i.toggleKey]:!0)}function It(t,s){const i=Et(t),n=Dt(i,s),m=Ct(s);return n.map(o=>({...o,title:xe(o.title,m),subsections:o.subsections.map(a=>({...a,title:a.title?xe(a.title,m):void 0,content:xe(a.content,m)}))}))}function Tt(t){return/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(t)}function me(t,s){return Tt(t)?"IBMPlexSansArabic":s}const M=je.create({brandedHeader:{position:"absolute",top:20,left:20,right:20,flexDirection:"row",justifyContent:"space-between",paddingBottom:15,borderBottomWidth:1,borderBottomColor:"#e5e7eb"},brandedHeaderRtl:{flexDirection:"row-reverse"},logoSection:{flexDirection:"row",alignItems:"center",gap:12},logoSectionRtl:{flexDirection:"row-reverse"},logo:{width:50,height:50,objectFit:"contain"},businessInfo:{flexDirection:"column"},businessName:{fontSize:16,fontWeight:700,marginBottom:2},businessDetail:{fontSize:9,color:"#666666",marginTop:1},contactInfo:{flexDirection:"column",alignItems:"flex-end"},contactInfoRtl:{alignItems:"flex-start"},contactText:{fontSize:9,color:"#666666",marginTop:1}});function ve(t,s){const i=t/100,m={USD:"$",ILS:"₪",EUR:"€"}[s]||"",o=i.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});return`${m}${o}`}function fe(t){return new Date(t).toLocaleDateString("en-GB",{day:"2-digit",month:"2-digit",year:"numeric"})}function Pt({snapshot:t,client:s,language:i,type:n,category:m,profile:o}){const a=Ne(i),c=wt(i),g=Nt(i),p=i==="ar",r=je.create({page:{fontFamily:c},text:{fontFamily:c,textAlign:g},row:{flexDirection:p?"row-reverse":"row"}}),w=n==="task",S=It(i,t),x=o?i==="ar"?o.name:o.nameEn||o.name:a.provider,y=o?i==="ar"?o.address1:o.address1En||o.address1:void 0,k=o?i==="ar"?o.city:o.cityEn||o.city:void 0,E=!!o?.logoDataUrl,T=me(x,c),A=me(s?.name||t.clientName||"",c);return e.jsx(tt,{children:e.jsxs(it,{size:"A4",style:[l.page,r.page,o?{paddingTop:90}:{}],children:[o&&e.jsxs(j,{style:p?[M.brandedHeader,M.brandedHeaderRtl]:M.brandedHeader,fixed:!0,children:[e.jsxs(j,{style:p?[M.logoSection,M.logoSectionRtl]:M.logoSection,children:[E&&e.jsx(nt,{src:o.logoDataUrl,style:M.logo}),e.jsxs(j,{style:M.businessInfo,children:[e.jsx(v,{style:[M.businessName,{fontFamily:T,textAlign:g}],children:x}),y&&e.jsx(v,{style:[M.businessDetail,{fontFamily:me(y,c),textAlign:g}],children:y}),k&&e.jsx(v,{style:[M.businessDetail,{fontFamily:me(k,c),textAlign:g}],children:k})]})]}),e.jsxs(j,{style:p?[M.contactInfo,M.contactInfoRtl]:M.contactInfo,children:[o.email&&e.jsx(v,{style:[M.contactText,{fontFamily:c}],children:o.email}),o.phone&&e.jsx(v,{style:[M.contactText,{fontFamily:c}],children:o.phone}),o.website&&e.jsx(v,{style:[M.contactText,{fontFamily:c}],children:o.website})]})]}),e.jsxs(j,{style:l.header,children:[e.jsx(v,{style:[l.title,r.text],children:bt(n,i)}),e.jsx(v,{style:[l.subtitle,r.text],children:jt(m,i)})]}),e.jsxs(j,{style:[l.partiesSection,r.row],children:[e.jsxs(j,{style:l.partyBox,children:[e.jsx(v,{style:[l.partyTitle,r.text],children:a.provider}),e.jsx(v,{style:[l.partyName,{fontFamily:T,textAlign:g}],children:x})]}),e.jsxs(j,{style:l.partyBox,children:[e.jsx(v,{style:[l.partyTitle,r.text],children:a.client}),e.jsx(v,{style:[l.partyName,{fontFamily:A,textAlign:g}],children:s?.name||t.clientName||"-"}),s?.email&&e.jsx(v,{style:[{fontSize:10},r.text],children:s.email})]})]}),(t.title||t.summary)&&e.jsxs(j,{style:l.section,children:[e.jsx(v,{style:[l.sectionTitle,r.text],children:a.summary}),e.jsxs(j,{style:l.sectionContent,children:[t.title&&e.jsx(v,{style:[l.paragraph,r.text,{fontWeight:600}],children:t.title}),t.summary&&e.jsx(v,{style:[l.paragraph,r.text],children:t.summary})]})]}),t.deliverables&&t.deliverables.length>0&&e.jsxs(j,{style:l.section,children:[e.jsx(v,{style:[l.sectionTitle,r.text],children:a.deliverables}),e.jsx(j,{style:l.list,children:t.deliverables.map((h,d)=>e.jsxs(j,{style:l.listItem,children:[e.jsx(v,{style:l.listBullet,children:"•"}),e.jsxs(v,{style:[l.listContent,r.text],children:[h.description,h.quantity?` (${h.quantity})`:"",h.format?` - ${h.format}`:""]})]},h.id||d))})]}),t.exclusions&&t.exclusions.length>0&&e.jsxs(j,{style:l.section,children:[e.jsx(v,{style:[l.sectionTitle,r.text],children:a.exclusions}),e.jsx(j,{style:l.list,children:t.exclusions.map((h,d)=>e.jsxs(j,{style:l.listItem,children:[e.jsx(v,{style:l.listBullet,children:"•"}),e.jsx(v,{style:[l.listContent,r.text],children:h})]},d))})]}),t.dependencies&&t.dependencies.length>0&&e.jsxs(j,{style:l.section,children:[e.jsx(v,{style:[l.sectionTitle,r.text],children:a.dependencies}),e.jsx(j,{style:l.list,children:t.dependencies.map((h,d)=>e.jsxs(j,{style:l.listItem,children:[e.jsx(v,{style:l.listBullet,children:"•"}),e.jsx(v,{style:[l.listContent,r.text],children:h})]},d))})]}),e.jsxs(j,{style:l.section,children:[e.jsx(v,{style:[l.sectionTitle,r.text],children:a.timeline}),e.jsxs(j,{style:l.sectionContent,children:[t.startDate&&e.jsxs(j,{style:l.infoRow,children:[e.jsxs(v,{style:[l.infoLabel,r.text],children:[a.startDate,":"]}),e.jsx(v,{style:[l.infoValue,r.text],children:fe(t.startDate)})]}),t.endDate&&e.jsxs(j,{style:l.infoRow,children:[e.jsxs(v,{style:[l.infoLabel,r.text],children:[a.endDate,":"]}),e.jsx(v,{style:[l.infoValue,r.text],children:fe(t.endDate)})]}),e.jsxs(j,{style:l.infoRow,children:[e.jsxs(v,{style:[l.infoLabel,r.text],children:[a.reviewWindow,":"]}),e.jsxs(v,{style:[l.infoValue,r.text],children:[t.reviewWindowDays," ",a.days]})]})]})]}),t.milestones&&t.milestones.length>0&&e.jsxs(j,{style:l.section,children:[e.jsx(v,{style:[l.sectionTitle,r.text],children:a.milestones}),e.jsx(j,{style:l.table,children:t.milestones.map((h,d)=>e.jsxs(j,{style:l.tableRow,children:[e.jsx(v,{style:[l.tableCell,r.text,{flex:2}],children:h.title}),e.jsx(v,{style:[l.tableCell,r.text,{flex:1}],children:h.targetDate?fe(h.targetDate):"-"})]},h.id||d))})]}),e.jsxs(j,{style:l.section,children:[e.jsx(v,{style:[l.sectionTitle,r.text],children:a.reviews}),e.jsxs(j,{style:l.sectionContent,children:[e.jsxs(j,{style:l.infoRow,children:[e.jsxs(v,{style:[l.infoLabel,r.text],children:[a.revisionRounds,":"]}),e.jsxs(v,{style:[l.infoValue,r.text],children:[t.revisionRounds," ",a.rounds]})]}),t.bugFixDays&&e.jsxs(j,{style:l.infoRow,children:[e.jsxs(v,{style:[l.infoLabel,r.text],children:[a.bugFixPeriod,":"]}),e.jsxs(v,{style:[l.infoValue,r.text],children:[t.bugFixDays," ",a.days]})]})]})]}),e.jsxs(j,{style:l.section,children:[e.jsx(v,{style:[l.sectionTitle,r.text],children:a.payment}),e.jsxs(j,{style:l.sectionContent,children:[w&&t.totalAmountMinor?e.jsxs(e.Fragment,{children:[e.jsxs(j,{style:l.infoRow,children:[e.jsxs(v,{style:[l.infoLabel,r.text],children:[a.totalAmount,":"]}),e.jsx(v,{style:[l.amount,r.text],children:ve(t.totalAmountMinor,t.currency)})]}),t.depositPercent?e.jsxs(j,{style:l.infoRow,children:[e.jsxs(v,{style:[l.infoLabel,r.text],children:[a.deposit,":"]}),e.jsxs(v,{style:[l.infoValue,r.text],children:[t.depositPercent,a.percent]})]}):null]}):e.jsxs(e.Fragment,{children:[t.retainerAmountMinor?e.jsxs(j,{style:l.infoRow,children:[e.jsxs(v,{style:[l.infoLabel,r.text],children:[a.retainerAmount,":"]}),e.jsx(v,{style:[l.amount,r.text],children:ve(t.retainerAmountMinor,t.currency)})]}):null,t.billingDay&&e.jsxs(j,{style:l.infoRow,children:[e.jsxs(v,{style:[l.infoLabel,r.text],children:[a.billingDay,":"]}),e.jsx(v,{style:[l.infoValue,r.text],children:t.billingDay})]})]}),e.jsxs(j,{style:l.infoRow,children:[e.jsxs(v,{style:[l.infoLabel,r.text],children:[a.lateFee,":"]}),e.jsx(v,{style:[l.infoValue,r.text],children:t.lateFeeEnabled?a.enabled:a.disabled})]})]})]}),w&&t.scheduleItems&&t.scheduleItems.length>0&&e.jsxs(j,{style:l.section,children:[e.jsx(v,{style:[l.sectionTitle,r.text],children:a.paymentSchedule}),e.jsx(j,{style:l.table,children:t.scheduleItems.map((h,d)=>e.jsxs(j,{style:l.tableRow,children:[e.jsx(v,{style:[l.tableCell,r.text,{flex:2}],children:h.label||Rt(h.trigger,a)}),e.jsx(v,{style:[l.tableCell,r.text,{flex:1,textAlign:"right"}],children:ve(h.amountMinor,h.currency)})]},h.id||d))})]}),e.jsxs(j,{style:l.section,children:[e.jsx(v,{style:[l.sectionTitle,r.text],children:a.relationship}),e.jsxs(j,{style:l.sectionContent,children:[e.jsxs(j,{style:l.infoRow,children:[e.jsxs(v,{style:[l.infoLabel,r.text],children:[a.termType,":"]}),e.jsx(v,{style:[l.infoValue,r.text],children:t.termType==="month-to-month"?a.monthToMonth:a.fixed})]}),e.jsxs(j,{style:l.infoRow,children:[e.jsxs(v,{style:[l.infoLabel,r.text],children:[a.terminationNotice,":"]}),e.jsxs(v,{style:[l.infoValue,r.text],children:[t.terminationNoticeDays," ",a.days]})]}),t.cancellationCoveragePercent?e.jsxs(j,{style:l.infoRow,children:[e.jsxs(v,{style:[l.infoLabel,r.text],children:[a.cancellationCoverage,":"]}),e.jsxs(v,{style:[l.infoValue,r.text],children:[t.cancellationCoveragePercent,a.percent]})]}):null,e.jsxs(j,{style:l.infoRow,children:[e.jsxs(v,{style:[l.infoLabel,r.text],children:[a.ownershipTransfer,":"]}),e.jsx(v,{style:[l.infoValue,r.text],children:t.ownershipTransferRule?.replace(/_/g," ")||"-"})]})]})]}),S.length>0&&e.jsx(j,{wrap:!1,children:e.jsx(j,{style:l.legalClausesHeader,children:e.jsx(v,{style:[l.legalClausesTitle,r.text],children:a.legalTerms})})}),S.map(h=>e.jsxs(j,{style:l.legalSection,children:[e.jsx(v,{style:[l.legalSectionTitle,r.text],children:h.title}),h.subsections.map(d=>e.jsxs(j,{style:l.legalSubsection,children:[d.title&&e.jsx(v,{style:[l.legalSubsectionTitle,r.text],children:d.title}),e.jsx(v,{style:[l.legalSubsectionContent,r.text],children:d.content})]},d.id))]},h.id)),e.jsxs(j,{style:[l.signatureSection,r.row],children:[e.jsxs(j,{style:l.signatureBox,children:[e.jsx(j,{style:l.signatureLine}),e.jsx(v,{style:[l.signatureLabel,r.text],children:a.provider})]}),e.jsxs(j,{style:l.signatureBox,children:[e.jsx(j,{style:l.signatureLine}),e.jsx(v,{style:[l.signatureLabel,r.text],children:a.client})]})]}),e.jsx(j,{style:l.footer,children:e.jsx(v,{style:r.text,children:a.generatedBy})})]})})}function Rt(t,s){return{on_signing:s.onSigning,on_milestone:s.onMilestone,on_completion:s.onCompletion,monthly:s.monthly}[t]||t}async function Be(t){const{snapshot:s,client:i,language:n,type:m,category:o,profile:a,filename:c}=t;try{const g=I.createElement(Pt,{snapshot:s,client:i,language:n,type:m,category:o,profile:a}),p=await st(g).toBlob(),w=(i?.name||s.clientName||"draft").replace(/[^a-zA-Z0-9-_]/g,"-"),S=new Date().toISOString().slice(0,10),x=`engagement-${w}-${S}.pdf`,y=URL.createObjectURL(p),k=document.createElement("a");return k.href=y,k.download=c||x,document.body.appendChild(k),k.click(),document.body.removeChild(k),URL.revokeObjectURL(y),{success:!0}}catch(g){const p=g instanceof Error?g.message:"Unknown error generating PDF";return console.error("Failed to generate engagement PDF:",g),{success:!1,error:p}}}function Zi(){const t=be(),{language:s}=ze(),i=Fe(s),n=ye(),[m,o]=I.useState("all"),[a,c]=I.useState(void 0),[g,p]=I.useState(void 0),[r,w]=I.useState(void 0),[S,x]=I.useState(void 0),[y,k]=I.useState(""),[E,T]=I.useState(void 0),A=I.useMemo(()=>{const b={search:y||void 0,profileId:r,clientId:S,type:a,category:g,includeArchived:m==="archived"};return m==="draft"?b.status="draft":m==="final"?b.status="final":m==="archived"&&(b.status="archived"),b},[m,a,g,r,S,y]),{data:h=[],isLoading:d}=lt(A),{data:N}=mt(),{data:D=[]}=ue(),{data:O=[]}=he(),{data:z}=dt(E||""),q=b=>{T(b)},V=()=>{n({to:"/engagements/new"})},U=b=>{n({to:"/engagements/$engagementId/edit",params:{engagementId:b}})};return e.jsxs(e.Fragment,{children:[e.jsx(Le,{title:t("engagements.title"),rightSlot:e.jsx("div",{className:"topbar-actions",children:e.jsxs("button",{className:"btn btn-primary",onClick:V,children:["+ ",t("engagements.new")]})})}),e.jsxs("div",{className:"engagements-layout",children:[e.jsxs("aside",{className:"engagements-filter-panel",children:[e.jsxs("div",{className:"filter-section",children:[e.jsx("h4",{className:"filter-section-title",children:t("engagements.filters.view")}),e.jsx("div",{className:"filter-radio-group",children:["all","draft","final","archived"].map(b=>e.jsxs("label",{className:C("filter-radio",m===b&&"active"),children:[e.jsx("input",{type:"radio",name:"view",checked:m===b,onChange:()=>o(b)}),e.jsx("span",{children:t(`engagements.filters.${b}`)}),N&&b!=="all"&&e.jsx("span",{className:"filter-count",children:N[b]})]},b))})]}),e.jsxs("div",{className:"filter-section",children:[e.jsx("h4",{className:"filter-section-title",children:t("engagements.filters.type")}),e.jsxs("select",{className:"select filter-select",value:a||"",onChange:b=>c(b.target.value||void 0),children:[e.jsx("option",{value:"",children:t("common.all")}),e.jsx("option",{value:"task",children:t("engagements.type.task")}),e.jsx("option",{value:"retainer",children:t("engagements.type.retainer")})]})]}),e.jsxs("div",{className:"filter-section",children:[e.jsx("h4",{className:"filter-section-title",children:t("engagements.filters.category")}),e.jsxs("select",{className:"select filter-select",value:g||"",onChange:b=>p(b.target.value||void 0),children:[e.jsx("option",{value:"",children:t("common.all")}),e.jsx("option",{value:"design",children:t("engagements.category.design")}),e.jsx("option",{value:"development",children:t("engagements.category.development")}),e.jsx("option",{value:"consulting",children:t("engagements.category.consulting")}),e.jsx("option",{value:"marketing",children:t("engagements.category.marketing")}),e.jsx("option",{value:"legal",children:t("engagements.category.legal")}),e.jsx("option",{value:"other",children:t("engagements.category.other")})]})]}),e.jsxs("div",{className:"filter-section",children:[e.jsx("h4",{className:"filter-section-title",children:t("engagements.filters.profile")}),e.jsxs("select",{className:"select filter-select",value:r||"",onChange:b=>w(b.target.value||void 0),children:[e.jsx("option",{value:"",children:t("common.all")}),D.map(b=>e.jsx("option",{value:b.id,children:b.name},b.id))]})]}),e.jsxs("div",{className:"filter-section",children:[e.jsx("h4",{className:"filter-section-title",children:t("engagements.filters.client")}),e.jsxs("select",{className:"select filter-select",value:S||"",onChange:b=>x(b.target.value||void 0),children:[e.jsx("option",{value:"",children:t("common.all")}),O.map(b=>e.jsx("option",{value:b.id,children:b.name},b.id))]})]}),e.jsx("div",{className:"filter-section",children:e.jsx($e,{value:y,onChange:k,placeholder:t("engagements.searchPlaceholder")})}),N&&e.jsxs("div",{className:"filter-section engagements-summary",children:[e.jsx("h4",{className:"filter-section-title",children:t("engagements.summary")}),e.jsxs("div",{className:"engagements-summary-stat",children:[e.jsx("span",{className:"engagements-summary-label",children:t("engagements.draftCount")}),e.jsx("span",{className:"engagements-summary-value",children:N.draft})]}),e.jsxs("div",{className:"engagements-summary-stat",children:[e.jsx("span",{className:"engagements-summary-label",children:t("engagements.finalCount")}),e.jsx("span",{className:"engagements-summary-value",children:N.final})]}),e.jsxs("div",{className:"engagements-summary-stat",children:[e.jsx("span",{className:"engagements-summary-label",children:t("engagements.archivedCount")}),e.jsx("span",{className:"engagements-summary-value",children:N.archived})]})]})]}),e.jsx("main",{className:"engagements-main",children:d?e.jsx("div",{className:"loading",children:e.jsx("div",{className:"spinner"})}):h.length===0?e.jsx(et,{title:t("engagements.empty"),description:t(y?"engagements.emptySearch":"engagements.emptyHint"),action:y?void 0:{label:t("engagements.addEngagement"),onClick:V}}):e.jsx("div",{className:"table-container",children:e.jsxs("table",{className:"data-table",children:[e.jsx("thead",{children:e.jsxs("tr",{children:[e.jsx("th",{children:t("engagements.columns.status")}),e.jsx("th",{children:t("engagements.columns.title")}),e.jsx("th",{children:t("engagements.columns.client")}),e.jsx("th",{children:t("engagements.columns.type")}),e.jsx("th",{children:t("engagements.columns.category")}),e.jsx("th",{children:t("engagements.columns.language")}),e.jsx("th",{children:t("engagements.columns.versions")}),e.jsx("th",{children:t("engagements.columns.updated")})]})}),e.jsx("tbody",{children:h.map(b=>e.jsxs("tr",{className:C("clickable",E===b.id&&"selected"),onClick:()=>q(b.id),children:[e.jsx("td",{children:e.jsx(_e,{status:b.status})}),e.jsx("td",{className:"cell-primary",children:b.title||t("engagements.untitled")}),e.jsx("td",{children:b.clientName||"-"}),e.jsx("td",{children:e.jsx("span",{className:"type-badge",children:t(`engagements.type.${b.type}`)})}),e.jsx("td",{children:e.jsx("span",{className:"category-badge",children:t(`engagements.category.${b.category}`)})}),e.jsx("td",{children:e.jsx("span",{className:C("language-badge",`lang-${b.primaryLanguage}`),children:b.primaryLanguage==="ar"?"AR":"EN"})}),e.jsx("td",{className:"cell-center",children:b.versionCount||0}),e.jsx("td",{children:b.updatedAt?new Date(b.updatedAt).toLocaleDateString(i,{month:"short",day:"numeric",year:"numeric"}):"-"})]},b.id))})]})})}),e.jsx("aside",{className:C("engagements-inspector",E&&"visible"),children:z?e.jsx(At,{engagement:z,onClose:()=>T(void 0),onEdit:()=>U(z.id)}):e.jsx("div",{className:"inspector-placeholder",children:e.jsx("p",{children:t("engagements.selectToInspect")})})})]})]})}function _e({status:t}){const s=be();return e.jsx("span",{className:C("status-badge",`status-${t}`),children:s(`engagements.status.${t}`)})}function At({engagement:t,onClose:s,onEdit:i}){const n=be(),{language:m}=ze(),o=Fe(m),a=ye(),[c,g]=I.useState(!1),{showToast:p}=Me(),r=ut(),w=ht(),S=gt(),{data:x}=Oe(t.id),{data:y=[]}=he(),{data:k=[]}=ue(),E=()=>{confirm(n("engagements.confirmArchive"))&&r.mutate(t.id)},T=()=>{w.mutate(t.id)},A=()=>{S.mutate({id:t.id},{onSuccess:N=>{a({to:"/engagements/$engagementId/edit",params:{engagementId:N.id}})}})},h=async()=>{if(d){g(!0);try{const N=y.find(z=>z.id===t.clientId),D=k.find(z=>z.id===d.profileId),O=await Be({snapshot:d,client:N,language:t.primaryLanguage,type:t.type,category:t.category,profile:D});O.success?p("PDF downloaded"):(console.error("PDF generation failed:",O.error),p("Failed to download PDF. Please try again."))}catch(N){console.error("Failed to download PDF:",N),p("Failed to download PDF. Please try again.")}finally{g(!1)}}},d=x?.snapshot;return e.jsxs("div",{className:"inspector-content",children:[e.jsxs("div",{className:"inspector-header",children:[e.jsx("h3",{className:"inspector-title",children:t.title||n("engagements.untitled")}),e.jsx("button",{className:"btn-icon",onClick:s,"aria-label":n("common.close"),children:e.jsx(zt,{})})]}),e.jsxs("div",{className:"inspector-section",children:[e.jsx("h4",{className:"inspector-section-title",children:n("engagements.inspector.overview")}),e.jsxs("dl",{className:"inspector-details",children:[e.jsxs("div",{className:"inspector-detail",children:[e.jsx("dt",{children:n("engagements.inspector.client")}),e.jsx("dd",{children:t.clientName||n("common.noClient")})]}),t.projectName&&e.jsxs("div",{className:"inspector-detail",children:[e.jsx("dt",{children:n("engagements.inspector.project")}),e.jsx("dd",{children:t.projectName})]}),e.jsxs("div",{className:"inspector-detail",children:[e.jsx("dt",{children:n("engagements.inspector.type")}),e.jsx("dd",{children:n(`engagements.type.${t.type}`)})]}),e.jsxs("div",{className:"inspector-detail",children:[e.jsx("dt",{children:n("engagements.inspector.category")}),e.jsx("dd",{children:n(`engagements.category.${t.category}`)})]}),e.jsxs("div",{className:"inspector-detail",children:[e.jsx("dt",{children:n("engagements.inspector.language")}),e.jsx("dd",{children:t.primaryLanguage==="ar"?"Arabic":"English"})]}),e.jsxs("div",{className:"inspector-detail",children:[e.jsx("dt",{children:n("engagements.inspector.status")}),e.jsx("dd",{children:e.jsx(_e,{status:t.status})})]}),e.jsxs("div",{className:"inspector-detail",children:[e.jsx("dt",{children:n("engagements.inspector.versions")}),e.jsx("dd",{children:t.versionCount||0})]}),e.jsxs("div",{className:"inspector-detail",children:[e.jsx("dt",{children:n("engagements.inspector.created")}),e.jsx("dd",{children:new Date(t.createdAt).toLocaleDateString(o)})]}),t.lastVersionAt&&e.jsxs("div",{className:"inspector-detail",children:[e.jsx("dt",{children:n("engagements.inspector.lastUpdated")}),e.jsx("dd",{children:new Date(t.lastVersionAt).toLocaleDateString(o)})]})]})]}),d?.summary&&e.jsxs("div",{className:"inspector-section",children:[e.jsx("h4",{className:"inspector-section-title",children:n("engagements.inspector.summary")}),e.jsx("p",{className:"inspector-summary",children:d.summary})]}),d&&e.jsxs("div",{className:"inspector-section",children:[e.jsx("h4",{className:"inspector-section-title",children:n("engagements.inspector.scope")}),e.jsxs("dl",{className:"inspector-details",children:[e.jsxs("div",{className:"inspector-detail",children:[e.jsx("dt",{children:n("engagements.inspector.deliverables")}),e.jsx("dd",{children:d.deliverables?.length||0})]}),e.jsxs("div",{className:"inspector-detail",children:[e.jsx("dt",{children:n("engagements.inspector.exclusions")}),e.jsx("dd",{children:d.exclusions?.length||0})]}),e.jsxs("div",{className:"inspector-detail",children:[e.jsx("dt",{children:n("engagements.inspector.milestones")}),e.jsx("dd",{children:d.milestones?.length||0})]})]})]}),e.jsxs("div",{className:"inspector-actions",children:[t.status!=="archived"&&e.jsx("button",{className:"btn btn-primary",onClick:i,children:t.status==="final"?n("common.view"):n("common.edit")}),t.status==="final"&&d&&e.jsx("button",{className:"btn btn-secondary",onClick:h,disabled:c,children:n(c?"common.downloading":"engagements.downloadPdf")}),e.jsx("button",{className:"btn btn-secondary",onClick:A,disabled:S.isPending,children:n("engagements.duplicate")}),t.status==="archived"?e.jsx("button",{className:"btn btn-secondary",onClick:T,disabled:w.isPending,children:n("engagements.restore")}):e.jsx("button",{className:"btn btn-danger",onClick:E,disabled:r.isPending,children:n("engagements.archive")})]})]})}function zt(){return e.jsx("svg",{width:"20",height:"20",fill:"none",viewBox:"0 0 24 24",stroke:"currentColor",strokeWidth:1.5,children:e.jsx("path",{strokeLinecap:"round",strokeLinejoin:"round",d:"M6 18 18 6M6 6l12 12"})})}const re=9,oe=["Client Setup","Summary","Scope","Timeline","Reviews","Payment","Relationship","Terms","Review & Export"],Ie={currentStep:0,mode:"create",engagementId:void 0,engagementType:"task",engagementCategory:"design",primaryLanguage:"en",isDirty:!1,lastSavedAt:void 0,isLoading:!1,isSaving:!1,prefillProfileId:void 0,prefillClientId:void 0,prefillProjectId:void 0,visitedSteps:new Set([0])},K=Ye((t,s)=>({...Ie,setStep:i=>{const n=s();n.canNavigateToStep(i)&&t({currentStep:i,visitedSteps:new Set([...n.visitedSteps,i])})},nextStep:()=>{const{currentStep:i}=s(),n=Math.min(i+1,re-1);s().setStep(n)},prevStep:()=>{const{currentStep:i}=s(),n=Math.max(i-1,0);t({currentStep:n})},setEngagementId:i=>t({engagementId:i}),setEngagementType:i=>t({engagementType:i}),setEngagementCategory:i=>t({engagementCategory:i}),setPrimaryLanguage:i=>t({primaryLanguage:i}),setDirty:i=>t({isDirty:i}),setLastSavedAt:i=>t({lastSavedAt:i}),setIsLoading:i=>t({isLoading:i}),setIsSaving:i=>t({isSaving:i}),setPrefill:i=>t({prefillProfileId:i.profileId,prefillClientId:i.clientId,prefillProjectId:i.projectId,engagementType:i.type||"task"}),markStepVisited:i=>t(n=>({visitedSteps:new Set([...n.visitedSteps,i])})),canNavigateToStep:i=>{const{visitedSteps:n,currentStep:m}=s();return n.has(i)?!0:i===m+1},reset:()=>t({...Ie,visitedSteps:new Set([0])}),initializeForEdit:i=>t({mode:"edit",engagementId:i.engagementId,engagementType:i.type,engagementCategory:i.category,primaryLanguage:i.language,currentStep:0,visitedSteps:new Set([0,1,2,3,4,5,6,7,8])})})),Se="engagement_wizard_autosave",Lt=2e3;function Ft(t,s,i,n){const m=I.useRef(void 0),o=I.useRef(s);o.current=s;const a=I.useCallback(()=>{const c={engagementId:t,snapshot:o.current,savedAt:new Date().toISOString()};localStorage.setItem(Se,JSON.stringify(c)),n?.(c.savedAt)},[t,n]);return I.useEffect(()=>{if(i)return m.current&&clearTimeout(m.current),m.current=setTimeout(a,Lt),()=>{m.current&&clearTimeout(m.current)}},[s,i,a]),I.useEffect(()=>()=>{m.current&&(clearTimeout(m.current),i&&a())},[i,a]),{saveNow:a}}function Ve(){try{const t=localStorage.getItem(Se);return t?JSON.parse(t):null}catch{return null}}function Te(){localStorage.removeItem(Se)}function Mt(){const t=Ve();if(!t)return!1;const s=new Date(t.savedAt),i=new Date(Date.now()-3600*1e3);return s>i}const Ot=[{id:"no_deposit",severity:"high",stepIndex:5,fieldPath:"depositPercent",messageKey:"clarityCheck.noDeposit",check:(t,s)=>s==="task"&&(t.depositPercent===void 0||t.depositPercent===0)},{id:"no_exclusions",severity:"high",stepIndex:2,fieldPath:"exclusions",messageKey:"clarityCheck.noExclusions",check:t=>!t.exclusions||t.exclusions.length===0},{id:"no_review_window",severity:"high",stepIndex:3,fieldPath:"reviewWindowDays",messageKey:"clarityCheck.noReviewWindow",check:t=>t.reviewWindowDays===void 0||t.reviewWindowDays===0},{id:"no_capacity_cap",severity:"high",stepIndex:4,fieldPath:"monthlyCapacity",messageKey:"clarityCheck.noCapacityCap",check:(t,s)=>s==="retainer"&&!t.monthlyCapacity&&(!t.outOfScopeRateMinor||t.outOfScopeRateMinor===0)},{id:"no_termination_notice",severity:"medium",stepIndex:6,fieldPath:"terminationNoticeDays",messageKey:"clarityCheck.noTerminationNotice",check:t=>t.terminationNoticeDays===void 0||t.terminationNoticeDays===0},{id:"no_bug_fix_window",severity:"medium",stepIndex:4,fieldPath:"bugFixDays",messageKey:"clarityCheck.noBugFixWindow",check:(t,s,i)=>i==="development"&&(t.bugFixDays===void 0||t.bugFixDays===0)},{id:"no_revision_limit",severity:"medium",stepIndex:4,fieldPath:"revisionRounds",messageKey:"clarityCheck.noRevisionLimit",check:(t,s,i)=>i==="design"&&(t.revisionRounds===void 0||t.revisionRounds===0)},{id:"no_dependencies",severity:"medium",stepIndex:2,fieldPath:"dependencies",messageKey:"clarityCheck.noDependencies",check:t=>!t.dependencies||t.dependencies.length===0},{id:"no_deliverables",severity:"medium",stepIndex:2,fieldPath:"deliverables",messageKey:"clarityCheck.noDeliverables",check:t=>!t.deliverables||t.deliverables.length===0},{id:"no_milestones",severity:"medium",stepIndex:3,fieldPath:"milestones",messageKey:"clarityCheck.noMilestones",check:(t,s)=>s==="task"&&(!t.milestones||t.milestones.length===0)},{id:"late_fee_off",severity:"low",stepIndex:5,fieldPath:"lateFeeEnabled",messageKey:"clarityCheck.lateFeeOff",check:t=>t.lateFeeEnabled===!1},{id:"no_dispute_path",severity:"low",stepIndex:7,fieldPath:"disputePath",messageKey:"clarityCheck.noDisputePath",check:t=>!t.disputePath},{id:"no_governing_law",severity:"low",stepIndex:7,fieldPath:"governingLaw",messageKey:"clarityCheck.noGoverningLaw",check:t=>!t.governingLaw},{id:"no_ownership_rule",severity:"low",stepIndex:6,fieldPath:"ownershipTransferRule",messageKey:"clarityCheck.noOwnershipRule",check:t=>!t.ownershipTransferRule},{id:"no_summary",severity:"low",stepIndex:1,fieldPath:"summary",messageKey:"clarityCheck.noSummary",check:t=>!t.summary||t.summary.trim().length===0}];function Bt(t,s,i){return I.useMemo(()=>{const n=[];for(const o of Ot)o.check(t,s,i)&&n.push({id:o.id,severity:o.severity,stepIndex:o.stepIndex,fieldPath:o.fieldPath,messageKey:o.messageKey});const m={high:0,medium:1,low:2};return n.sort((o,a)=>m[o.severity]-m[a.severity]),n},[t,s,i])}function _t(t,s){return t.filter(i=>i.stepIndex===s)}function Ue(t){return{high:t.filter(s=>s.severity==="high").length,medium:t.filter(s=>s.severity==="medium").length,low:t.filter(s=>s.severity==="low").length,total:t.length}}function Vt(t){return t.some(s=>s.severity==="high")}const Ut={"clarityCheck.noDeposit":{en:"No deposit required - Consider requesting upfront payment to protect your work",ar:"لا يوجد دفعة مقدمة - فكر في طلب دفعة مقدمة لحماية عملك"},"clarityCheck.noExclusions":{en:"No exclusions defined - Clearly state what is NOT included to avoid scope creep",ar:"لم يتم تحديد استثناءات - حدد بوضوح ما هو غير مشمول لتجنب توسع النطاق"},"clarityCheck.noReviewWindow":{en:"No review window set - Define how long the client has to review deliverables",ar:"لم يتم تحديد فترة المراجعة - حدد المدة المتاحة للعميل لمراجعة التسليمات"},"clarityCheck.noCapacityCap":{en:"No capacity cap for retainer - Set monthly limits or out-of-scope rates",ar:"لا يوجد حد للقدرة في الاشتراك - حدد الحدود الشهرية أو أسعار العمل خارج النطاق"},"clarityCheck.noTerminationNotice":{en:"No termination notice period - Define how much notice is required to end the agreement",ar:"لا يوجد فترة إشعار للإنهاء - حدد مدة الإشعار المطلوبة لإنهاء الاتفاقية"},"clarityCheck.noBugFixWindow":{en:"No bug fix window defined - For development work, specify how long you will fix bugs after delivery",ar:"لم يتم تحديد فترة إصلاح الأخطاء - لأعمال التطوير، حدد مدة إصلاح الأخطاء بعد التسليم"},"clarityCheck.noRevisionLimit":{en:"No revision limit set - For design work, specify how many revision rounds are included",ar:"لم يتم تحديد حد للمراجعات - لأعمال التصميم، حدد عدد جولات المراجعة المشمولة"},"clarityCheck.noDependencies":{en:"No dependencies listed - Document what you need from the client to proceed",ar:"لم يتم تحديد متطلبات - وثق ما تحتاجه من العميل للمتابعة"},"clarityCheck.noDeliverables":{en:"No deliverables defined - List specific outputs the client will receive",ar:"لم يتم تحديد التسليمات - حدد المخرجات التي سيستلمها العميل"},"clarityCheck.noMilestones":{en:"No milestones set - Breaking work into milestones helps track progress",ar:"لم يتم تحديد معالم - تقسيم العمل إلى معالم يساعد في تتبع التقدم"},"clarityCheck.lateFeeOff":{en:"Late payment fee disabled - Consider enabling to encourage timely payments",ar:"رسوم التأخير معطلة - فكر في تفعيلها لتشجيع الدفع في الوقت المحدد"},"clarityCheck.noDisputePath":{en:"No dispute resolution path - Define how disagreements will be resolved",ar:"لم يتم تحديد مسار حل النزاعات - حدد كيفية حل الخلافات"},"clarityCheck.noGoverningLaw":{en:"No governing law specified - Consider stating which jurisdiction applies",ar:"لم يتم تحديد القانون المعمول به - فكر في تحديد الاختصاص القضائي المطبق"},"clarityCheck.noOwnershipRule":{en:"No ownership transfer rule - Define when work ownership transfers to the client",ar:"لم يتم تحديد قاعدة نقل الملكية - حدد متى تنتقل ملكية العمل للعميل"},"clarityCheck.noSummary":{en:"No project summary - A brief description helps set expectations",ar:"لا يوجد ملخص للمشروع - وصف موجز يساعد في تحديد التوقعات"}},Pe={profileId:"",profileName:"",clientId:"",clientName:"",title:"",summary:"",deliverables:[],exclusions:[],dependencies:[],milestones:[],reviewWindowDays:3,silenceEqualsApproval:!1,revisionRounds:2,revisionDefinition:[],changeRequestRule:!0,currency:"USD",scheduleItems:[],lateFeeEnabled:!1,termType:"fixed",terminationNoticeDays:14,ownershipTransferRule:"upon_full_payment",confidentiality:!0,ipOwnership:!0,warrantyDisclaimer:!0,limitationOfLiability:!0,nonSolicitation:!1,disputePath:"negotiation"};function Wt({risks:t=[],className:s}){const{currentStep:i,setStep:n,visitedSteps:m,canNavigateToStep:o}=K();return e.jsxs("div",{className:C("wizard-progress",s),children:[e.jsx("div",{className:"wizard-progress-track",children:Array.from({length:re},(a,c)=>{const g=c,p=i===g,r=m.has(g)&&i>g,w=o(g)||m.has(g),S=_t(t,g),x=S.some(k=>k.severity==="high"),y=S.some(k=>k.severity==="medium");return e.jsxs("div",{className:"wizard-step-container",children:[c>0&&e.jsx("div",{className:C("wizard-connector",(r||p)&&"wizard-connector-active")}),e.jsxs("button",{type:"button",className:C("wizard-step",p&&"wizard-step-active",r&&"wizard-step-completed",!w&&"wizard-step-disabled",x&&"wizard-step-risk-high",y&&!x&&"wizard-step-risk-medium"),onClick:()=>w&&n(g),disabled:!w,title:oe[g],children:[r?e.jsx("svg",{className:"wizard-step-check",viewBox:"0 0 20 20",fill:"currentColor",width:"14",height:"14",children:e.jsx("path",{fillRule:"evenodd",d:"M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z",clipRule:"evenodd"})}):e.jsx("span",{className:"wizard-step-number",children:c+1}),S.length>0&&e.jsx("span",{className:C("wizard-step-risk-dot",x&&"risk-high",y&&!x&&"risk-medium")})]}),e.jsx("span",{className:C("wizard-step-label",p&&"wizard-step-label-active"),children:oe[g]})]},g)})}),e.jsxs("div",{className:"wizard-progress-bar-mobile",children:[e.jsx("div",{className:"wizard-progress-bar-fill",style:{width:`${(i+1)/re*100}%`}}),e.jsxs("span",{className:"wizard-progress-text",children:["Step ",i+1," of ",re,": ",oe[i]]})]}),e.jsx("style",{children:`
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
      `})]})}function Gt({onSaveDraft:t,onFinalize:s,isSaving:i=!1,isValid:n=!0,className:m}){const{currentStep:o,nextStep:a,prevStep:c,lastSavedAt:g,isDirty:p}=K(),r=o===0,w=o===re-1,S=()=>g?`Last saved: ${new Date(g).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}`:null;return e.jsxs("div",{className:C("wizard-navigation",m),children:[e.jsxs("div",{className:"wizard-nav-left",children:[e.jsx("button",{type:"button",className:"btn btn-ghost",onClick:c,disabled:r||i,children:"← Previous"}),e.jsx("div",{className:"wizard-nav-status",children:i?e.jsx("span",{className:"text-muted",children:"Saving..."}):g?e.jsx("span",{className:"text-muted",children:S()}):p?e.jsx("span",{className:"text-muted",children:"Unsaved changes"}):null})]}),e.jsxs("div",{className:"wizard-nav-right",children:[e.jsx("button",{type:"button",className:"btn btn-secondary",onClick:t,disabled:i,children:i?"Saving...":"Save Draft"}),w?e.jsx("button",{type:"button",className:"btn btn-primary",onClick:s,disabled:i||!n,children:"Finalize & Export"}):e.jsx("button",{type:"button",className:"btn btn-primary",onClick:a,disabled:i,children:"Next →"})]}),e.jsx("style",{children:`
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
      `})]})}function We({risks:t,className:s}){const[i,n]=I.useState(!0),{setStep:m}=K(),o=Ue(t),a=r=>{m(r.stepIndex)},c=r=>{switch(r){case"high":return"var(--danger)";case"medium":return"var(--warning)";case"low":return"var(--text-muted)"}},g=r=>{switch(r){case"high":return"High";case"medium":return"Medium";case"low":return"Low"}},p=r=>Ut[r]?.en||r;return t.length===0?e.jsxs("div",{className:C("clarity-check-panel clarity-check-success",s),children:[e.jsxs("div",{className:"clarity-check-header",children:[e.jsx("svg",{viewBox:"0 0 20 20",fill:"currentColor",width:"20",height:"20",className:"clarity-check-icon-success",children:e.jsx("path",{fillRule:"evenodd",d:"M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z",clipRule:"evenodd"})}),e.jsx("span",{children:"Clarity Check"})]}),e.jsx("p",{className:"clarity-check-success-message",children:"Looking good! No issues found."}),e.jsx("style",{children:Re})]}):e.jsxs("div",{className:C("clarity-check-panel",s),children:[e.jsxs("button",{type:"button",className:"clarity-check-header",onClick:()=>n(!i),children:[e.jsxs("div",{className:"clarity-check-header-left",children:[e.jsx("svg",{viewBox:"0 0 20 20",fill:"currentColor",width:"20",height:"20",className:"clarity-check-icon-warning",children:e.jsx("path",{fillRule:"evenodd",d:"M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z",clipRule:"evenodd"})}),e.jsx("span",{children:"Clarity Check"}),e.jsxs("span",{className:"clarity-check-count",children:[o.total," ",o.total===1?"issue":"issues"]})]}),e.jsx("svg",{viewBox:"0 0 20 20",fill:"currentColor",width:"16",height:"16",className:C("clarity-check-chevron",i&&"expanded"),children:e.jsx("path",{fillRule:"evenodd",d:"M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z",clipRule:"evenodd"})})]}),i&&e.jsxs(e.Fragment,{children:[e.jsxs("div",{className:"clarity-check-summary",children:[o.high>0&&e.jsxs("span",{className:"clarity-badge clarity-badge-high",children:[o.high," high"]}),o.medium>0&&e.jsxs("span",{className:"clarity-badge clarity-badge-medium",children:[o.medium," medium"]}),o.low>0&&e.jsxs("span",{className:"clarity-badge clarity-badge-low",children:[o.low," low"]})]}),e.jsx("div",{className:"clarity-check-list",children:t.map(r=>e.jsxs("button",{type:"button",className:"clarity-check-item",onClick:()=>a(r),children:[e.jsx("div",{className:"clarity-check-dot",style:{background:c(r.severity)}}),e.jsxs("div",{className:"clarity-check-item-content",children:[e.jsxs("div",{className:"clarity-check-item-header",children:[e.jsxs("span",{className:"clarity-check-item-step",children:["Step ",r.stepIndex+1,": ",oe[r.stepIndex]]}),e.jsx("span",{className:"clarity-check-item-severity",style:{color:c(r.severity)},children:g(r.severity)})]}),e.jsx("p",{className:"clarity-check-item-message",children:p(r.messageKey)})]})]},r.id))})]}),e.jsx("style",{children:Re})]})}const Re=`
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
`;function qt({snapshot:t,client:s,project:i,language:n,className:m}){const o=n==="ar",a=(c,g)=>{if(c===void 0)return"—";const p=c/100;return new Intl.NumberFormat(n==="ar"?"ar-SA":"en-US",{style:"currency",currency:g||"USD"}).format(p)};return e.jsxs("div",{className:C("engagement-preview",o&&"rtl",m),children:[e.jsxs("div",{className:"preview-document",children:[e.jsxs("div",{className:"preview-header",children:[e.jsx("h1",{className:"preview-title",children:t.title||(n==="ar"?"اتفاقية عمل":"Engagement Agreement")}),s&&e.jsxs("p",{className:"preview-client",children:[n==="ar"?"العميل: ":"Client: ",s.name]}),i&&e.jsxs("p",{className:"preview-project",children:[n==="ar"?"المشروع: ":"Project: ",i.name]})]}),t.summary&&e.jsxs("div",{className:"preview-section",children:[e.jsx("h2",{children:n==="ar"?"نظرة عامة":"Overview"}),e.jsx("p",{children:t.summary}),t.clientGoal&&e.jsxs("p",{className:"preview-goal",children:[e.jsx("strong",{children:n==="ar"?"الهدف: ":"Goal: "}),t.clientGoal]})]}),t.deliverables&&t.deliverables.length>0&&e.jsxs("div",{className:"preview-section",children:[e.jsx("h2",{children:n==="ar"?"التسليمات":"Deliverables"}),e.jsx("ul",{children:t.deliverables.map((c,g)=>e.jsxs("li",{children:[c.description,c.quantity&&e.jsxs("span",{className:"preview-qty",children:[" (×",c.quantity,")"]}),c.format&&e.jsxs("span",{className:"preview-format",children:[" [",c.format,"]"]})]},c.id||g))})]}),t.exclusions&&t.exclusions.length>0&&e.jsxs("div",{className:"preview-section",children:[e.jsx("h2",{children:n==="ar"?"الاستثناءات":"Exclusions"}),e.jsx("ul",{className:"preview-exclusions",children:t.exclusions.map((c,g)=>e.jsx("li",{children:c},g))})]}),(t.startDate||t.milestones?.length)&&e.jsxs("div",{className:"preview-section",children:[e.jsx("h2",{children:n==="ar"?"الجدول الزمني":"Timeline"}),t.startDate&&e.jsxs("p",{children:[e.jsx("strong",{children:n==="ar"?"تاريخ البدء: ":"Start Date: "}),new Date(t.startDate).toLocaleDateString(n==="ar"?"ar-SA":"en-US")]}),t.endDate&&e.jsxs("p",{children:[e.jsx("strong",{children:n==="ar"?"تاريخ الانتهاء: ":"End Date: "}),new Date(t.endDate).toLocaleDateString(n==="ar"?"ar-SA":"en-US")]}),t.milestones&&t.milestones.length>0&&e.jsxs("div",{className:"preview-milestones",children:[e.jsx("h3",{children:n==="ar"?"المراحل":"Milestones"}),e.jsx("ul",{children:t.milestones.map((c,g)=>e.jsxs("li",{children:[c.title,c.targetDate&&e.jsxs("span",{className:"preview-date",children:[" ","— ",new Date(c.targetDate).toLocaleDateString(n==="ar"?"ar-SA":"en-US")]})]},c.id||g))})]})]}),e.jsxs("div",{className:"preview-section",children:[e.jsx("h2",{children:n==="ar"?"الدفع":"Payment"}),t.totalAmountMinor!==void 0&&e.jsxs("p",{className:"preview-total",children:[e.jsx("strong",{children:n==="ar"?"الإجمالي: ":"Total: "}),a(t.totalAmountMinor,t.currency)]}),t.depositPercent!==void 0&&t.depositPercent>0&&e.jsxs("p",{children:[e.jsx("strong",{children:n==="ar"?"الدفعة المقدمة: ":"Deposit: "}),t.depositPercent,"%"]}),t.scheduleItems&&t.scheduleItems.length>0&&e.jsxs("div",{className:"preview-schedule",children:[e.jsx("h3",{children:n==="ar"?"جدول الدفع":"Payment Schedule"}),e.jsx("ul",{children:t.scheduleItems.map((c,g)=>e.jsxs("li",{children:[c.label,": ",a(c.amountMinor,c.currency)]},c.id||g))})]})]}),e.jsxs("div",{className:"preview-section",children:[e.jsx("h2",{children:n==="ar"?"الشروط":"Terms"}),e.jsxs("div",{className:"preview-terms-grid",children:[t.confidentiality&&e.jsx("span",{className:"preview-term-badge",children:n==="ar"?"سرية":"Confidentiality"}),t.ipOwnership&&e.jsx("span",{className:"preview-term-badge",children:n==="ar"?"ملكية فكرية":"IP Ownership"}),t.warrantyDisclaimer&&e.jsx("span",{className:"preview-term-badge",children:n==="ar"?"إخلاء ضمان":"Warranty Disclaimer"}),t.limitationOfLiability&&e.jsx("span",{className:"preview-term-badge",children:n==="ar"?"حد المسؤولية":"Liability Limit"}),t.nonSolicitation&&e.jsx("span",{className:"preview-term-badge",children:n==="ar"?"عدم الاستقطاب":"Non-Solicitation"})]}),t.terminationNoticeDays!==void 0&&t.terminationNoticeDays>0&&e.jsxs("p",{children:[e.jsx("strong",{children:n==="ar"?"فترة الإشعار: ":"Notice Period: "}),t.terminationNoticeDays," ",n==="ar"?"يوم":"days"]})]}),e.jsx("div",{className:"preview-footer",children:e.jsx("p",{className:"preview-disclaimer",children:n==="ar"?"هذا مستند معاينة. المستند النهائي سيتضمن جميع التفاصيل القانونية.":"This is a preview document. The final document will include all legal details."})})]}),e.jsx("style",{children:`
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
      `})]})}const Ht=[{value:"task",label:"Task-Based",description:"One-time project with defined deliverables and timeline"},{value:"retainer",label:"Retainer",description:"Ongoing monthly agreement with recurring work"}],Qt=[{value:"design",label:"Design"},{value:"development",label:"Development"},{value:"consulting",label:"Consulting"},{value:"legal",label:"Legal"},{value:"marketing",label:"Marketing"},{value:"other",label:"Other"}],Kt=[{value:"en",label:"English"},{value:"ar",label:"Arabic (العربية)"}];function $t({className:t}){const{control:s,watch:i,setValue:n}=$(),{engagementType:m,setEngagementType:o,engagementCategory:a,setEngagementCategory:c,primaryLanguage:g,setPrimaryLanguage:p,prefillProfileId:r}=K(),{data:w=[]}=ue(),{data:S}=Xe(),{data:x=[]}=he(),y=i("clientId"),k=i("profileId"),{data:E=[]}=Je(y||void 0);I.useEffect(()=>{if(!k&&w.length>0){const d=r?w.find(N=>N.id===r):S||w[0];d&&(n("profileId",d.id),n("profileName",d.name))}},[k,w,S,r,n]);const T=d=>{n("profileId",d);const N=w.find(D=>D.id===d);n("profileName",N?.name||"")},A=d=>{n("clientId",d);const N=x.find(D=>D.id===d);n("clientName",N?.name||""),n("projectId",void 0),n("projectName",void 0)},h=d=>{n("projectId",d);const N=E.find(D=>D.id===d);n("projectName",N?.name||void 0)};return e.jsxs("div",{className:C("wizard-step-content",t),children:[e.jsxs("div",{className:"step-header",children:[e.jsx("h2",{className:"step-title",children:"Client Setup"}),e.jsx("p",{className:"step-description",children:"Choose your client and configure the engagement type."})]}),e.jsxs("div",{className:"form-section",children:[e.jsxs("div",{className:"form-group",children:[e.jsx("label",{className:"form-label",children:"Business Profile *"}),e.jsx(F,{name:"profileId",control:s,rules:{required:"Profile is required"},render:({field:d,fieldState:N})=>e.jsxs(e.Fragment,{children:[e.jsxs("select",{className:C("select",N.error&&"select-error"),value:d.value||"",onChange:D=>T(D.target.value),children:[e.jsx("option",{value:"",children:"Select a profile..."}),w.map(D=>e.jsx("option",{value:D.id,children:D.name},D.id))]}),N.error&&e.jsx("p",{className:"form-error",children:N.error.message})]})}),e.jsx("p",{className:"form-hint",children:"The business profile used for this engagement document."})]}),e.jsxs("div",{className:"form-group",children:[e.jsx("label",{className:"form-label",children:"Client *"}),e.jsx(F,{name:"clientId",control:s,rules:{required:"Client is required"},render:({field:d,fieldState:N})=>e.jsxs(e.Fragment,{children:[e.jsxs("select",{className:C("select",N.error&&"select-error"),value:d.value||"",onChange:D=>A(D.target.value),children:[e.jsx("option",{value:"",children:"Select a client..."}),x.map(D=>e.jsx("option",{value:D.id,children:D.name},D.id))]}),N.error&&e.jsx("p",{className:"form-error",children:N.error.message})]})})]}),y&&E.length>0&&e.jsxs("div",{className:"form-group",children:[e.jsx("label",{className:"form-label",children:"Project (Optional)"}),e.jsx(F,{name:"projectId",control:s,render:({field:d})=>e.jsxs("select",{className:"select",value:d.value||"",onChange:N=>h(N.target.value||void 0),children:[e.jsx("option",{value:"",children:"No specific project"}),E.map(N=>e.jsx("option",{value:N.id,children:N.name},N.id))]})}),e.jsx("p",{className:"form-hint",children:"Link this engagement to an existing project for better tracking."})]})]}),e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Engagement Type"}),e.jsx("div",{className:"type-selector",children:Ht.map(d=>e.jsxs("button",{type:"button",className:C("type-option",m===d.value&&"type-option-active"),onClick:()=>o(d.value),children:[e.jsx("span",{className:"type-option-label",children:d.label}),e.jsx("span",{className:"type-option-description",children:d.description})]},d.value))})]}),e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Category"}),e.jsx("div",{className:"category-selector",children:Qt.map(d=>e.jsx("button",{type:"button",className:C("category-option",a===d.value&&"category-option-active"),onClick:()=>c(d.value),children:d.label},d.value))})]}),e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Document Language"}),e.jsx("div",{className:"language-selector",children:Kt.map(d=>e.jsx("button",{type:"button",className:C("language-option",g===d.value&&"language-option-active"),onClick:()=>p(d.value),children:d.label},d.value))}),e.jsx("p",{className:"form-hint",children:"The engagement document will be generated in this language."})]}),e.jsx("style",{children:`
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
      `})]})}function Yt({className:t}){const{register:s,formState:{errors:i}}=$();return e.jsxs("div",{className:C("wizard-step-content",t),children:[e.jsxs("div",{className:"step-header",children:[e.jsx("h2",{className:"step-title",children:"Project Summary"}),e.jsx("p",{className:"step-description",children:"Provide a clear title and summary that will appear at the top of the engagement document."})]}),e.jsxs("div",{className:"form-section",children:[e.jsxs("div",{className:"form-group",children:[e.jsx("label",{className:"form-label",children:"Engagement Title *"}),e.jsx("input",{type:"text",className:C("input",i.title&&"input-error"),placeholder:"e.g., Website Redesign Project",...s("title",{required:"Title is required"})}),i.title&&e.jsx("p",{className:"form-error",children:i.title.message}),e.jsx("p",{className:"form-hint",children:"A clear, descriptive title for this engagement."})]}),e.jsxs("div",{className:"form-group",children:[e.jsx("label",{className:"form-label",children:"Project Summary *"}),e.jsx("textarea",{className:C("textarea",i.summary&&"textarea-error"),rows:5,placeholder:"Describe the project scope and objectives in a few sentences...",...s("summary",{required:"Summary is required"})}),i.summary&&e.jsx("p",{className:"form-error",children:i.summary.message}),e.jsx("p",{className:"form-hint",children:"This summary helps set expectations and appears prominently in the document."})]}),e.jsxs("div",{className:"form-group",children:[e.jsx("label",{className:"form-label",children:"Client's Goal (Optional)"}),e.jsx("textarea",{className:"textarea",rows:3,placeholder:"What is the client trying to achieve? What problem are you solving?",...s("clientGoal")}),e.jsx("p",{className:"form-hint",children:"Understanding the client's goal helps align expectations and demonstrates you understand their needs."})]})]}),e.jsx("style",{children:`
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
      `})]})}function pe(t,s){return t[s]}const Xt=[{en:"Brand guidelines",ar:"إرشادات العلامة التجارية"},{en:"Content copy",ar:"المحتوى النصي"},{en:"Logo assets (vector format)",ar:"ملفات الشعار (بصيغة فيكتور)"},{en:"Image assets",ar:"الصور والوسائط"},{en:"Access to existing design files",ar:"الوصول لملفات التصميم الحالية"}],Jt=[{en:"API documentation",ar:"توثيق واجهات البرمجة"},{en:"Server/hosting access",ar:"الوصول للخادم/الاستضافة"},{en:"Database credentials",ar:"بيانات قاعدة البيانات"},{en:"Design mockups",ar:"تصاميم الواجهات"},{en:"Functional requirements",ar:"المتطلبات الوظيفية"}],Zt=[{en:"Relevant contracts and agreements",ar:"العقود والاتفاقيات ذات الصلة"},{en:"Business registration documents",ar:"وثائق تسجيل الشركة"},{en:"Identification documents",ar:"وثائق الهوية"},{en:"Previous correspondence",ar:"المراسلات السابقة"}],ei=[{en:"Access to key stakeholders",ar:"الوصول لأصحاب المصلحة الرئيسيين"},{en:"Relevant internal documents",ar:"المستندات الداخلية ذات الصلة"},{en:"Current process documentation",ar:"توثيق العمليات الحالية"},{en:"Financial data (if applicable)",ar:"البيانات المالية (إن وجدت)"}],ti=[{en:"Brand guidelines",ar:"إرشادات العلامة التجارية"},{en:"Target audience profiles",ar:"ملفات الجمهور المستهدف"},{en:"Competitor analysis",ar:"تحليل المنافسين"},{en:"Access to analytics",ar:"الوصول للتحليلات"},{en:"Social media credentials",ar:"بيانات حسابات التواصل الاجتماعي"}],ii=[{en:"Project requirements document",ar:"وثيقة متطلبات المشروع"},{en:"Access to relevant stakeholders",ar:"الوصول لأصحاب المصلحة"}],ni=[{en:"Photography or photo shoots",ar:"التصوير الفوتوغرافي"},{en:"Copywriting or content creation",ar:"كتابة المحتوى"},{en:"Development or coding",ar:"البرمجة والتطوير"},{en:"Print production",ar:"الإنتاج الطباعي"},{en:"Stock images or fonts licensing",ar:"ترخيص الصور والخطوط"}],si=[{en:"UI/UX design",ar:"تصميم الواجهات"},{en:"Content creation",ar:"إنشاء المحتوى"},{en:"Server hosting fees",ar:"رسوم الاستضافة"},{en:"Third-party API costs",ar:"تكاليف واجهات الطرف الثالث"},{en:"Ongoing maintenance",ar:"الصيانة المستمرة"}],ai=[{en:"Court representation",ar:"التمثيل أمام المحاكم"},{en:"Government filing fees",ar:"رسوم التسجيل الحكومية"},{en:"Notarization costs",ar:"تكاليف التوثيق"},{en:"Translation services",ar:"خدمات الترجمة"}],ri=[{en:"Implementation of recommendations",ar:"تنفيذ التوصيات"},{en:"Ongoing operational support",ar:"الدعم التشغيلي المستمر"},{en:"Staff training",ar:"تدريب الموظفين"},{en:"Technology procurement",ar:"شراء التقنيات"}],oi=[{en:"Ad spend budget",ar:"ميزانية الإعلانات"},{en:"Video production",ar:"إنتاج الفيديو"},{en:"Influencer fees",ar:"أتعاب المؤثرين"},{en:"Print production",ar:"الإنتاج الطباعي"},{en:"Event management",ar:"إدارة الفعاليات"}],li=[{en:"Ongoing support after delivery",ar:"الدعم المستمر بعد التسليم"},{en:"Third-party costs",ar:"تكاليف الأطراف الثالثة"}],ci=[{id:"logo-design",description:{en:"Logo design",ar:"تصميم الشعار"},defaultQuantity:1},{id:"brand-guidelines",description:{en:"Brand guidelines document",ar:"دليل الهوية البصرية"},defaultQuantity:1,defaultFormat:"PDF"},{id:"website-mockup",description:{en:"Website mockup",ar:"تصميم الموقع"},defaultQuantity:1,defaultFormat:"Figma"},{id:"mobile-mockup",description:{en:"Mobile app mockup",ar:"تصميم التطبيق"},defaultQuantity:1,defaultFormat:"Figma"},{id:"social-templates",description:{en:"Social media templates",ar:"قوالب التواصل الاجتماعي"},defaultQuantity:5,defaultFormat:"PNG/PSD"},{id:"business-card",description:{en:"Business card design",ar:"تصميم بطاقة العمل"},defaultQuantity:1},{id:"presentation",description:{en:"Presentation template",ar:"قالب العرض التقديمي"},defaultQuantity:1,defaultFormat:"PPTX"},{id:"icon-set",description:{en:"Custom icon set",ar:"مجموعة أيقونات مخصصة"},defaultQuantity:10,defaultFormat:"SVG"}],di=[{id:"website",description:{en:"Responsive website",ar:"موقع متجاوب"},defaultQuantity:1},{id:"mobile-app",description:{en:"Mobile application",ar:"تطبيق جوال"},defaultQuantity:1},{id:"web-app",description:{en:"Web application",ar:"تطبيق ويب"},defaultQuantity:1},{id:"api",description:{en:"API development",ar:"تطوير واجهة برمجية"},defaultQuantity:1},{id:"database",description:{en:"Database design & setup",ar:"تصميم وإعداد قاعدة البيانات"},defaultQuantity:1},{id:"integration",description:{en:"Third-party integration",ar:"تكامل مع طرف ثالث"},defaultQuantity:1},{id:"testing",description:{en:"Testing & QA",ar:"الاختبار وضمان الجودة"},defaultQuantity:1},{id:"documentation",description:{en:"Technical documentation",ar:"التوثيق الفني"},defaultQuantity:1,defaultFormat:"MD"}],mi=[{id:"contract-draft",description:{en:"Contract draft",ar:"مسودة العقد"},defaultQuantity:1,defaultFormat:"DOCX"},{id:"contract-review",description:{en:"Contract review",ar:"مراجعة العقد"},defaultQuantity:1},{id:"legal-opinion",description:{en:"Legal opinion",ar:"الرأي القانوني"},defaultQuantity:1,defaultFormat:"PDF"},{id:"terms-conditions",description:{en:"Terms & conditions",ar:"الشروط والأحكام"},defaultQuantity:1},{id:"privacy-policy",description:{en:"Privacy policy",ar:"سياسة الخصوصية"},defaultQuantity:1},{id:"nda",description:{en:"NDA draft",ar:"اتفاقية السرية"},defaultQuantity:1},{id:"incorporation",description:{en:"Incorporation documents",ar:"وثائق التأسيس"},defaultQuantity:1}],pi=[{id:"assessment",description:{en:"Current state assessment",ar:"تقييم الوضع الحالي"},defaultQuantity:1,defaultFormat:"PDF"},{id:"strategy",description:{en:"Strategic recommendations",ar:"التوصيات الاستراتيجية"},defaultQuantity:1,defaultFormat:"PDF"},{id:"roadmap",description:{en:"Implementation roadmap",ar:"خارطة التنفيذ"},defaultQuantity:1,defaultFormat:"PDF"},{id:"workshop",description:{en:"Workshop facilitation",ar:"تيسير ورشة العمل"},defaultQuantity:1},{id:"report",description:{en:"Final report",ar:"التقرير النهائي"},defaultQuantity:1,defaultFormat:"PDF"},{id:"presentation",description:{en:"Executive presentation",ar:"العرض التنفيذي"},defaultQuantity:1,defaultFormat:"PPTX"}],ui=[{id:"marketing-strategy",description:{en:"Marketing strategy",ar:"استراتيجية التسويق"},defaultQuantity:1,defaultFormat:"PDF"},{id:"social-strategy",description:{en:"Social media strategy",ar:"استراتيجية التواصل الاجتماعي"},defaultQuantity:1},{id:"content-calendar",description:{en:"Content calendar",ar:"تقويم المحتوى"},defaultQuantity:1,defaultFormat:"Sheet"},{id:"ad-campaign",description:{en:"Ad campaign setup",ar:"إعداد الحملة الإعلانية"},defaultQuantity:1},{id:"seo-audit",description:{en:"SEO audit",ar:"تدقيق السيو"},defaultQuantity:1,defaultFormat:"PDF"},{id:"analytics-report",description:{en:"Analytics report",ar:"تقرير التحليلات"},defaultQuantity:1,defaultFormat:"PDF"},{id:"email-campaign",description:{en:"Email campaign",ar:"حملة البريد الإلكتروني"},defaultQuantity:1}],hi=[{id:"deliverable-1",description:{en:"Project deliverable",ar:"مخرج المشروع"},defaultQuantity:1},{id:"report",description:{en:"Project report",ar:"تقرير المشروع"},defaultQuantity:1,defaultFormat:"PDF"}],ke={design:{dependencies:Xt,exclusions:ni,deliverablePresets:ci},development:{dependencies:Jt,exclusions:si,deliverablePresets:di},legal:{dependencies:Zt,exclusions:ai,deliverablePresets:mi},consulting:{dependencies:ei,exclusions:ri,deliverablePresets:pi},marketing:{dependencies:ti,exclusions:oi,deliverablePresets:ui},other:{dependencies:ii,exclusions:li,deliverablePresets:hi}};function Ge(t,s){const i=ke[t];return{dependencies:i.dependencies.map(n=>pe(n,s)),exclusions:i.exclusions.map(n=>pe(n,s))}}function gi(t,s){return Ge(t,s)}function xi(t,s){return ke[t].deliverablePresets.map(n=>({...n,displayText:pe(n.description,s)}))}function vi(t,s,i){const m=ke[s].deliverablePresets.find(o=>o.id===t);return m?{id:Q(),description:pe(m.description,i),quantity:m.defaultQuantity,format:m.defaultFormat,source:"preset",presetId:m.id}:null}function fi(t,s,i){return!i&&t.length===0&&s.length===0}function yi({className:t}){const{register:s,control:i,setValue:n,getValues:m}=$(),{engagementCategory:o,primaryLanguage:a}=K(),[c,g]=I.useState(""),[p,r]=I.useState(""),[w,S]=I.useState(!0),{fields:x,append:y,remove:k}=ne({control:i,name:"deliverables"}),{fields:E,append:T,remove:A}=ne({control:i,name:"exclusions"}),{fields:h,append:d,remove:N}=ne({control:i,name:"dependencies"}),D=I.useMemo(()=>xi(o,a),[o,a]),O=I.useMemo(()=>new Set(x.map(u=>u.presetId).filter(Boolean)),[x]);I.useEffect(()=>{const u=m("dependencies")||[],f=m("exclusions")||[],B=m("defaultsApplied");if(fi(u,f,B)){const J=Ge(o,a);n("dependencies",J.dependencies),n("exclusions",J.exclusions),n("defaultsApplied",!0)}},[o,a,m,n]);const z=()=>{y({id:Q(),description:"",quantity:1,source:"custom"})},q=u=>{const f=vi(u,o,a);f&&y(f)},V=()=>{c.trim()&&(T(c.trim()),g(""))},U=()=>{p.trim()&&(d(p.trim()),r(""))},b=()=>{const u=gi(o,a);n("dependencies",u.dependencies),n("exclusions",u.exclusions),n("defaultsApplied",!0)};return e.jsxs("div",{className:C("wizard-step-content",t),children:[e.jsxs("div",{className:"step-header",children:[e.jsx("h2",{className:"step-title",children:"Scope of Work"}),e.jsx("p",{className:"step-description",children:"Define what's included and excluded from this engagement."})]}),e.jsxs("div",{className:"form-section",children:[e.jsxs("div",{className:"section-header",children:[e.jsx("h3",{className:"section-title",children:"Deliverables"}),e.jsx("button",{type:"button",className:"btn btn-ghost btn-sm",onClick:z,children:"+ Add Custom"})]}),e.jsx("p",{className:"section-hint",children:"List the specific outputs the client will receive."}),D.length>0&&e.jsxs("div",{className:"presets-panel",children:[e.jsxs("button",{type:"button",className:"presets-toggle",onClick:()=>S(!w),children:[e.jsx("span",{className:"presets-toggle-icon",children:w?"▼":"▶"}),"Quick Add from Presets"]}),w&&e.jsx("div",{className:"presets-grid",children:D.map(u=>{const f=O.has(u.id);return e.jsxs("button",{type:"button",className:C("preset-chip",f&&"preset-chip-used"),disabled:f,onClick:()=>q(u.id),children:[f?"✓ ":"+ ",u.displayText]},u.id)})})]}),e.jsxs("div",{className:"deliverables-list",children:[x.map((u,f)=>e.jsxs("div",{className:"deliverable-row",children:[e.jsxs("div",{className:"deliverable-main",children:[u.source==="preset"&&e.jsx("span",{className:"deliverable-badge",title:"From preset",children:"P"}),e.jsx("input",{type:"text",className:"input",placeholder:"e.g., Homepage design mockup",...s(`deliverables.${f}.description`)})]}),e.jsx("input",{type:"number",className:"input input-sm",min:"1",style:{width:80},placeholder:"Qty",...s(`deliverables.${f}.quantity`,{valueAsNumber:!0})}),e.jsx("input",{type:"text",className:"input input-sm",style:{width:100},placeholder:"Format",...s(`deliverables.${f}.format`)}),e.jsx("button",{type:"button",className:"btn btn-ghost btn-icon",onClick:()=>k(f),title:"Remove",children:"×"})]},u.id)),x.length===0&&e.jsxs("div",{className:"empty-list",children:[e.jsx("p",{children:"No deliverables added yet."}),e.jsx("button",{type:"button",className:"btn btn-secondary btn-sm",onClick:z,children:"Add First Deliverable"})]})]})]}),e.jsxs("div",{className:"form-section",children:[e.jsxs("div",{className:"section-header",children:[e.jsx("h3",{className:"section-title",children:"Exclusions"}),e.jsx("button",{type:"button",className:"btn btn-ghost btn-sm",onClick:b,title:"Reset to category defaults",children:"↺ Reset Defaults"})]}),e.jsx("p",{className:"section-hint",children:"Clearly state what is NOT included to avoid scope creep."}),e.jsxs("div",{className:"add-item-row",children:[e.jsx("input",{type:"text",className:"input",placeholder:"e.g., Ongoing maintenance, Third-party integrations",value:c,onChange:u=>g(u.target.value),onKeyDown:u=>u.key==="Enter"&&(u.preventDefault(),V())}),e.jsx("button",{type:"button",className:"btn btn-secondary btn-sm",onClick:V,children:"Add"})]}),e.jsx("div",{className:"tags-list",children:E.map((u,f)=>e.jsxs("span",{className:"tag",children:[typeof u=="string"?u:u.value||"",e.jsx("button",{type:"button",className:"tag-remove",onClick:()=>A(f),children:"×"})]},f))})]}),e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Dependencies"}),e.jsx("p",{className:"section-hint",children:"What do you need from the client to proceed?"}),e.jsxs("div",{className:"add-item-row",children:[e.jsx("input",{type:"text",className:"input",placeholder:"e.g., Brand guidelines, Content copy, Server access",value:p,onChange:u=>r(u.target.value),onKeyDown:u=>u.key==="Enter"&&(u.preventDefault(),U())}),e.jsx("button",{type:"button",className:"btn btn-secondary btn-sm",onClick:U,children:"Add"})]}),e.jsx("div",{className:"tags-list",children:h.map((u,f)=>e.jsxs("span",{className:"tag tag-dependency",children:[typeof u=="string"?u:u.value||"",e.jsx("button",{type:"button",className:"tag-remove",onClick:()=>N(f),children:"×"})]},f))})]}),e.jsx("style",{children:`
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
      `})]})}function bi(t,s,i){if(!s||!i||t===0)return Array(t).fill(void 0);const n=new Date(s),o=new Date(i).getTime()-n.getTime();if(o<=0)return Array(t).fill(void 0);const a=[];for(let c=0;c<t;c++){const g=Math.round((c+1)*o/(t+1)),p=new Date(n.getTime()+g);a.push(p.toISOString().split("T")[0])}return a}function ji(t,s,i,n=[]){if(t.length===0)return n;const m=n.filter(p=>p.userEdited),o=new Set(m.flatMap(p=>p.generatedFromDeliverableId?[p.generatedFromDeliverableId]:[])),a=t.filter(p=>!o.has(p.id)),c=bi(a.length,s,i),g=a.map((p,r)=>({id:Q(),title:p.description||`Milestone ${r+1}`,targetDate:c[r],deliverableIds:[p.id],generated:!0,userEdited:!1,generatedFromDeliverableId:p.id}));return[...m,...g]}function wi(t){return t.generated===!0}function Ni({className:t}){const{register:s,control:i,watch:n,setValue:m,getValues:o}=$(),{fields:a,append:c,remove:g,replace:p}=ne({control:i,name:"milestones"}),r=n("deliverables")||[],w=n("startDate"),S=n("endDate"),x=n("silenceEqualsApproval"),y=()=>{c({id:Q(),title:"",targetDate:void 0,deliverableIds:[],generated:!1,userEdited:!1})},k=()=>{const h=o("milestones")||[],d=ji(r,w,S,h);p(d)},E=h=>{const d=a[h];d.generated&&!d.userEdited&&m(`milestones.${h}.userEdited`,!0)},T=h=>{const d=a[h];d.generated&&!d.userEdited&&m(`milestones.${h}.userEdited`,!0)},A=r.length>0;return e.jsxs("div",{className:C("wizard-step-content",t),children:[e.jsxs("div",{className:"step-header",children:[e.jsx("h2",{className:"step-title",children:"Timeline & Milestones"}),e.jsx("p",{className:"step-description",children:"Set project dates and define key milestones for tracking progress."})]}),e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Project Dates"}),e.jsxs("div",{className:"form-row",children:[e.jsxs("div",{className:"form-group",children:[e.jsx("label",{className:"form-label",children:"Start Date"}),e.jsx("input",{type:"date",className:"input",...s("startDate")})]}),e.jsxs("div",{className:"form-group",children:[e.jsx("label",{className:"form-label",children:"Target End Date"}),e.jsx("input",{type:"date",className:"input",...s("endDate")})]})]})]}),e.jsxs("div",{className:"form-section",children:[e.jsxs("div",{className:"section-header",children:[e.jsx("h3",{className:"section-title",children:"Milestones"}),e.jsxs("div",{className:"section-actions",children:[A&&e.jsx("button",{type:"button",className:"btn btn-secondary btn-sm",onClick:k,title:"Generate milestones from deliverables",children:"⚡ Generate from Deliverables"}),e.jsx("button",{type:"button",className:"btn btn-ghost btn-sm",onClick:y,children:"+ Add Milestone"})]})]}),e.jsxs("p",{className:"section-hint",children:["Break the project into phases or checkpoints.",A&&' Click "Generate from Deliverables" to auto-create milestones.']}),e.jsxs("div",{className:"milestones-list",children:[a.map((h,d)=>{const N=h,D=wi(N),O=N.userEdited;return e.jsxs("div",{className:C("milestone-card",D&&!O&&"milestone-generated"),children:[e.jsxs("div",{className:"milestone-header",children:[e.jsxs("div",{className:"milestone-header-left",children:[e.jsxs("span",{className:"milestone-number",children:["#",d+1]}),D&&e.jsx("span",{className:C("milestone-badge",O&&"milestone-badge-edited"),children:O?"Auto (edited)":"Auto"})]}),e.jsx("button",{type:"button",className:"btn btn-ghost btn-icon btn-sm",onClick:()=>g(d),title:"Remove",children:"×"})]}),e.jsxs("div",{className:"milestone-body",children:[e.jsx("div",{className:"form-group",children:e.jsx("input",{type:"text",className:"input",placeholder:"Milestone title (e.g., Design Phase Complete)",...s(`milestones.${d}.title`),onChange:z=>{E(d),s(`milestones.${d}.title`).onChange(z)}})}),e.jsxs("div",{className:"form-group",children:[e.jsx("label",{className:"form-label-sm",children:"Target Date"}),e.jsx("input",{type:"date",className:"input",...s(`milestones.${d}.targetDate`),onChange:z=>{T(d),s(`milestones.${d}.targetDate`).onChange(z)}})]})]})]},h.id)}),a.length===0&&e.jsxs("div",{className:"empty-list",children:[e.jsx("p",{children:"No milestones defined."}),A?e.jsx("button",{type:"button",className:"btn btn-primary btn-sm",onClick:k,children:"Generate from Deliverables"}):e.jsx("button",{type:"button",className:"btn btn-secondary btn-sm",onClick:y,children:"Add First Milestone"})]})]})]}),e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Client Review Period"}),e.jsx("p",{className:"section-hint",children:"How long does the client have to review deliverables before they're considered approved?"}),e.jsx("div",{className:"form-row",children:e.jsxs("div",{className:"form-group",children:[e.jsx("label",{className:"form-label",children:"Review Window (Days)"}),e.jsx(F,{name:"reviewWindowDays",control:i,render:({field:h})=>e.jsx("input",{type:"number",className:"input",min:"0",max:"30",style:{width:100},value:h.value||0,onChange:d=>h.onChange(parseInt(d.target.value)||0)})})]})}),e.jsxs("div",{className:"form-group",children:[e.jsxs("label",{className:"checkbox-label",children:[e.jsx("input",{type:"checkbox",...s("silenceEqualsApproval")}),e.jsx("span",{children:"Silence equals approval"})]}),e.jsx("p",{className:"form-hint",children:x?"If the client doesn't respond within the review window, deliverables are considered approved.":"Explicit approval is required for each deliverable."})]})]}),e.jsx("style",{children:`
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
      `})]})}const Si=[{id:"minor_text",label:"Minor text changes"},{id:"color_adjust",label:"Color/font adjustments"},{id:"layout_change",label:"Layout changes"},{id:"new_element",label:"Adding new elements"},{id:"concept_change",label:"Concept direction change"},{id:"functionality",label:"Functionality changes"}];function ki({className:t}){const{register:s,control:i,watch:n,setValue:m}=$(),{engagementType:o,engagementCategory:a}=K(),[c,g]=I.useState(""),p=o==="task",r=o==="retainer",w=a==="design",S=a==="development",x=n("revisionDefinition")||[],{fields:y,append:k,remove:E}=ne({control:i,name:"scopeCategories"}),T=h=>{const d=x;d.includes(h)?m("revisionDefinition",d.filter(N=>N!==h)):m("revisionDefinition",[...d,h])},A=()=>{c.trim()&&(k(c.trim()),g(""))};return e.jsxs("div",{className:C("wizard-step-content",t),children:[e.jsxs("div",{className:"step-header",children:[e.jsx("h2",{className:"step-title",children:p?"Revisions & Support":"Capacity & Scope"}),e.jsx("p",{className:"step-description",children:p?"Define revision rounds and post-delivery support.":"Set capacity limits and scope boundaries for the retainer."})]}),p&&e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Revision Rounds"}),e.jsx("p",{className:"section-hint",children:"How many rounds of revisions are included in the price?"}),e.jsx("div",{className:"form-row",children:e.jsxs("div",{className:"form-group",children:[e.jsx("label",{className:"form-label",children:"Included Revisions"}),e.jsx(F,{name:"revisionRounds",control:i,render:({field:h})=>e.jsx("input",{type:"number",className:"input",min:"0",max:"10",style:{width:100},value:h.value||0,onChange:d=>h.onChange(parseInt(d.target.value)||0)})}),e.jsx("p",{className:"form-hint",children:"Set to 0 for unlimited revisions (not recommended)."})]})}),w&&e.jsxs("div",{className:"form-group",children:[e.jsx("label",{className:"form-label",children:"What counts as a revision?"}),e.jsx("p",{className:"form-hint",children:"Select which changes count toward revision rounds."}),e.jsx("div",{className:"checkbox-grid",children:Si.map(h=>e.jsxs("label",{className:"checkbox-label",children:[e.jsx("input",{type:"checkbox",checked:x.includes(h.id),onChange:()=>T(h.id)}),e.jsx("span",{children:h.label})]},h.id))})]}),e.jsxs("div",{className:"form-group",children:[e.jsxs("label",{className:"checkbox-label",children:[e.jsx("input",{type:"checkbox",...s("changeRequestRule")}),e.jsx("span",{children:"Changes beyond scope require a change request"})]}),e.jsx("p",{className:"form-hint",children:"If enabled, changes outside the original scope will be quoted separately."})]})]}),p&&S&&e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Post-Delivery Support"}),e.jsxs("div",{className:"form-group",children:[e.jsx("label",{className:"form-label",children:"Bug Fix Window (Days)"}),e.jsx(F,{name:"bugFixDays",control:i,render:({field:h})=>e.jsx("input",{type:"number",className:"input",min:"0",max:"90",style:{width:100},value:h.value||0,onChange:d=>h.onChange(parseInt(d.target.value)||0)})}),e.jsx("p",{className:"form-hint",children:"How many days after delivery will you fix bugs at no extra cost?"})]})]}),r&&e.jsxs(e.Fragment,{children:[e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Scope Categories"}),e.jsx("p",{className:"section-hint",children:"Define what types of work are included in the retainer."}),e.jsxs("div",{className:"add-item-row",children:[e.jsx("input",{type:"text",className:"input",placeholder:"e.g., Bug fixes, Feature development, Meetings",value:c,onChange:h=>g(h.target.value),onKeyDown:h=>h.key==="Enter"&&(h.preventDefault(),A())}),e.jsx("button",{type:"button",className:"btn btn-secondary btn-sm",onClick:A,children:"Add"})]}),e.jsx("div",{className:"tags-list",children:y.map((h,d)=>e.jsxs("span",{className:"tag",children:[typeof h=="string"?h:h.value||"",e.jsx("button",{type:"button",className:"tag-remove",onClick:()=>E(d),children:"×"})]},d))})]}),e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Monthly Capacity"}),e.jsxs("div",{className:"form-group",children:[e.jsx("label",{className:"form-label",children:"Capacity Description"}),e.jsx("input",{type:"text",className:"input",placeholder:"e.g., Up to 20 hours, 4 design assets, 2 feature requests",...s("monthlyCapacity")}),e.jsx("p",{className:"form-hint",children:"Describe what's included each month. Leave blank for unlimited (not recommended)."})]})]}),e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Response Time"}),e.jsxs("div",{className:"form-group",children:[e.jsx("label",{className:"form-label",children:"Response Time (Business Days)"}),e.jsx(F,{name:"responseTimeDays",control:i,render:({field:h})=>e.jsx("input",{type:"number",className:"input",min:"0",max:"14",style:{width:100},value:h.value||0,onChange:d=>h.onChange(parseInt(d.target.value)||0)})}),e.jsx("p",{className:"form-hint",children:"Maximum time to respond to client requests."})]})]})]}),e.jsx("style",{children:`
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
      `})]})}const qe=6;function Ci(t,s,i){if(t.length===0||s<=0)return[];const n=t.slice(0,qe),m=Math.floor(s/n.length),o=s-m*n.length;return n.map((a,c)=>({id:Q(),label:a.title||`Payment ${c+1}`,trigger:"on_milestone",milestoneId:a.id,amountMinor:m+(c===n.length-1?o:0),currency:i,generated:!0,userEdited:!1,generatedFromMilestoneId:a.id}))}function Ei(t,s,i){if(t.length===0||s<=0)return[];const n=Math.min(t.length,qe),m=Math.floor(s/n),o=s-m*n;return t.slice(0,n).map((a,c)=>({id:Q(),label:a.description||`Payment ${c+1}`,trigger:"on_completion",amountMinor:m+(c===n-1?o:0),currency:i,generated:!0,userEdited:!1}))}function Di(t,s,i="en"){if(t<=0)return[];const n={en:{deposit:"Deposit (30%)",agreement:"Agreement (40%)",completion:"Completion (30%)"},ar:{deposit:"الدفعة الأولى (30%)",agreement:"الاتفاق (40%)",completion:"عند الإنجاز (30%)"}},m=Math.round(t*.3),o=Math.round(t*.4),a=t-m-o;return[{id:Q(),label:n[i].deposit,trigger:"on_signing",amountMinor:m,currency:s,generated:!0,userEdited:!1},{id:Q(),label:n[i].agreement,trigger:"on_milestone",amountMinor:o,currency:s,generated:!0,userEdited:!1},{id:Q(),label:n[i].completion,trigger:"on_completion",amountMinor:a,currency:s,generated:!0,userEdited:!1}]}function He(t,s,i,n,m=[],o="en"){const a=m.filter(r=>r.userEdited),c=a.reduce((r,w)=>r+w.amountMinor,0),g=i-c;if(g<=0)return a;let p;if(t.length>0){const r=new Set(a.filter(S=>S.generatedFromMilestoneId).map(S=>S.generatedFromMilestoneId)),w=t.filter(S=>!r.has(S.id));p=Ci(w,g,n)}else s.length>0?p=Ei(s,g,n):p=Di(g,n,o);return[...a,...p]}function Ii(t,s,i,n,m="en"){return He(t,s,i,n,[],m)}function Ti(t,s){return t.length===0&&s>0}const Ae=[{value:"USD",label:"USD",symbol:"$"},{value:"ILS",label:"ILS",symbol:"₪"},{value:"EUR",label:"EUR",symbol:"€"}],Pi=[{value:"on_signing",label:"On signing"},{value:"on_milestone",label:"On milestone"},{value:"on_completion",label:"On completion"},{value:"monthly",label:"Monthly"}],Ri=[{value:"none",label:"No rollover",description:"Unused hours/capacity expire at month end"},{value:"carry",label:"Carry forward",description:"Unused capacity rolls to next month"},{value:"expire",label:"Use or lose",description:"Unused capacity is forfeited"}];function Ai({className:t}){const{register:s,control:i,watch:n,setValue:m,getValues:o}=$(),{engagementType:a,primaryLanguage:c}=K(),g=I.useRef(!1),p=a==="task",r=a==="retainer",w=n("currency")||"USD",S=n("totalAmountMinor")||0,x=n("depositPercent")||0,y=n("milestones")||[],k=n("deliverables")||[],{fields:E,append:T,remove:A,replace:h}=ne({control:i,name:"scheduleItems"}),d=Ae.find(u=>u.value===w)?.symbol||"$",N=u=>(u/100).toFixed(2),D=u=>Math.round(parseFloat(u||"0")*100);I.useEffect(()=>{if(g.current)return;const u=o("scheduleItems")||[],f=o("totalAmountMinor")||0;if(Ti(u,f)){const B=He(y,k,f,w,[],c);h(B),g.current=!0}},[o,y,k,w,c,h]);const O=()=>{T({id:Q(),label:"",trigger:"on_milestone",amountMinor:0,currency:w,generated:!1,userEdited:!1})},z=()=>{const u=Ii(y,k,S,w,c);h(u)},q=u=>{const f=E[u];f.generated&&!f.userEdited&&m(`scheduleItems.${u}.userEdited`,!0)},V=Math.round(S*x/100),U=E.reduce((u,f)=>u+(f.amountMinor||0),0),b=S-U;return e.jsxs("div",{className:C("wizard-step-content",t),children:[e.jsxs("div",{className:"step-header",children:[e.jsx("h2",{className:"step-title",children:"Payment Terms"}),e.jsx("p",{className:"step-description",children:p?"Set the total price and payment schedule.":"Configure retainer pricing and billing."})]}),e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Currency"}),e.jsx("div",{className:"currency-selector",children:Ae.map(u=>e.jsxs("button",{type:"button",className:C("currency-option",w===u.value&&"currency-option-active"),onClick:()=>m("currency",u.value),children:[u.symbol," ",u.label]},u.value))})]}),p&&e.jsxs(e.Fragment,{children:[e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Project Total"}),e.jsx("div",{className:"form-row",children:e.jsxs("div",{className:"form-group",children:[e.jsx("label",{className:"form-label",children:"Total Amount"}),e.jsxs("div",{className:"input-with-prefix",children:[e.jsx("span",{className:"input-prefix",children:d}),e.jsx(F,{name:"totalAmountMinor",control:i,render:({field:u})=>e.jsx("input",{type:"number",step:"0.01",min:"0",className:"input",value:N(u.value||0),onChange:f=>u.onChange(D(f.target.value))})})]})]})})]}),e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Deposit"}),e.jsxs("div",{className:"form-row",children:[e.jsxs("div",{className:"form-group",children:[e.jsx("label",{className:"form-label",children:"Deposit Percentage"}),e.jsxs("div",{className:"input-with-suffix",children:[e.jsx(F,{name:"depositPercent",control:i,render:({field:u})=>e.jsx("input",{type:"number",min:"0",max:"100",className:"input",style:{width:100},value:u.value||0,onChange:f=>u.onChange(parseInt(f.target.value)||0)})}),e.jsx("span",{className:"input-suffix",children:"%"})]})]}),x>0&&S>0&&e.jsxs("div",{className:"form-group",children:[e.jsx("label",{className:"form-label",children:"Deposit Amount"}),e.jsxs("p",{className:"calculated-value",children:[d,N(V)]})]})]}),e.jsx("p",{className:"form-hint",children:"A deposit protects your work and shows client commitment."})]}),e.jsxs("div",{className:"form-section",children:[e.jsxs("div",{className:"section-header",children:[e.jsx("h3",{className:"section-title",children:"Payment Schedule"}),e.jsxs("div",{className:"section-actions",children:[(y.length>0||k.length>0)&&e.jsx("button",{type:"button",className:"btn btn-secondary btn-sm",onClick:z,title:"Regenerate schedule from milestones/deliverables",children:"↺ Reset Schedule"}),e.jsx("button",{type:"button",className:"btn btn-ghost btn-sm",onClick:O,children:"+ Add Payment"})]})]}),E.length>0&&S>0&&b!==0&&e.jsx("div",{className:C("schedule-alert",b>0?"schedule-alert-warning":"schedule-alert-error"),children:b>0?`${d}${N(b)} remaining to allocate`:`Schedule exceeds total by ${d}${N(Math.abs(b))}`}),e.jsx("div",{className:"schedule-list",children:E.map((u,f)=>{const B=u,J=B.generated,ee=B.userEdited;return e.jsxs("div",{className:C("schedule-item",J&&!ee&&"schedule-item-generated"),children:[e.jsxs("div",{className:"schedule-item-main",children:[J&&e.jsx("span",{className:C("schedule-badge",ee&&"schedule-badge-edited"),title:ee?"Auto-generated (edited)":"Auto-generated",children:ee?"A*":"A"}),e.jsx("input",{type:"text",className:"input",placeholder:"Payment label",...s(`scheduleItems.${f}.label`),onChange:H=>{q(f),s(`scheduleItems.${f}.label`).onChange(H)}})]}),e.jsx(F,{name:`scheduleItems.${f}.trigger`,control:i,render:({field:H})=>e.jsx("select",{className:"select",value:H.value,onChange:W=>{q(f),H.onChange(W.target.value)},children:Pi.filter(W=>W.value!=="monthly").map(W=>e.jsx("option",{value:W.value,children:W.label},W.value))})}),e.jsxs("div",{className:"input-with-prefix",style:{width:150},children:[e.jsx("span",{className:"input-prefix",children:d}),e.jsx(F,{name:`scheduleItems.${f}.amountMinor`,control:i,render:({field:H})=>e.jsx("input",{type:"number",step:"0.01",min:"0",className:"input",value:N(H.value||0),onChange:W=>{q(f),H.onChange(D(W.target.value))}})})]}),e.jsx("button",{type:"button",className:"btn btn-ghost btn-icon",onClick:()=>A(f),children:"×"})]},u.id)})}),E.length===0&&S>0&&e.jsxs("div",{className:"empty-schedule",children:[e.jsx("p",{children:"No payment schedule defined."}),y.length>0||k.length>0?e.jsxs("button",{type:"button",className:"btn btn-primary btn-sm",onClick:z,children:["Generate from ",y.length>0?"Milestones":"Deliverables"]}):e.jsx("button",{type:"button",className:"btn btn-secondary btn-sm",onClick:O,children:"Add First Payment"})]})]})]}),r&&e.jsxs(e.Fragment,{children:[e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Monthly Retainer"}),e.jsxs("div",{className:"form-row",children:[e.jsxs("div",{className:"form-group",children:[e.jsx("label",{className:"form-label",children:"Monthly Amount"}),e.jsxs("div",{className:"input-with-prefix",children:[e.jsx("span",{className:"input-prefix",children:d}),e.jsx(F,{name:"retainerAmountMinor",control:i,render:({field:u})=>e.jsx("input",{type:"number",step:"0.01",min:"0",className:"input",value:N(u.value||0),onChange:f=>u.onChange(D(f.target.value))})})]})]}),e.jsxs("div",{className:"form-group",children:[e.jsx("label",{className:"form-label",children:"Billing Day"}),e.jsx(F,{name:"billingDay",control:i,render:({field:u})=>e.jsx("select",{className:"select",value:u.value||1,onChange:f=>u.onChange(parseInt(f.target.value)),children:Array.from({length:28},(f,B)=>B+1).map(f=>e.jsx("option",{value:f,children:f===1?"1st":f===2?"2nd":f===3?"3rd":`${f}th`},f))})})]})]})]}),e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Capacity Rollover"}),e.jsx("div",{className:"rollover-options",children:Ri.map(u=>e.jsx(F,{name:"rolloverRule",control:i,render:({field:f})=>e.jsxs("label",{className:C("rollover-option",f.value===u.value&&"active"),children:[e.jsx("input",{type:"radio",value:u.value,checked:f.value===u.value,onChange:B=>f.onChange(B.target.value)}),e.jsxs("div",{children:[e.jsx("span",{className:"rollover-label",children:u.label}),e.jsx("span",{className:"rollover-desc",children:u.description})]})]})},u.value))})]}),e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Out-of-Scope Rate"}),e.jsxs("div",{className:"form-group",children:[e.jsx("label",{className:"form-label",children:"Hourly Rate for Extra Work"}),e.jsxs("div",{className:"input-with-prefix",children:[e.jsx("span",{className:"input-prefix",children:d}),e.jsx(F,{name:"outOfScopeRateMinor",control:i,render:({field:u})=>e.jsx("input",{type:"number",step:"0.01",min:"0",className:"input",style:{width:120},value:N(u.value||0),onChange:f=>u.onChange(D(f.target.value))})})]}),e.jsx("p",{className:"form-hint",children:"Rate charged for work beyond the monthly capacity."})]})]})]}),e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Late Payment"}),e.jsxs("div",{className:"form-group",children:[e.jsxs("label",{className:"checkbox-label",children:[e.jsx("input",{type:"checkbox",...s("lateFeeEnabled")}),e.jsx("span",{children:"Enable late payment fee"})]}),e.jsx("p",{className:"form-hint",children:"A late fee clause encourages timely payments."})]})]}),e.jsx("style",{children:`
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
      `})]})}const zi=[{value:"fixed",label:"Fixed Term",description:"Agreement ends on a specific date or upon project completion"},{value:"month-to-month",label:"Month-to-Month",description:"Agreement continues until either party terminates"}],Li=[{value:"upon_full_payment",label:"Upon full payment"},{value:"upon_milestone_payment",label:"Upon milestone payment"},{value:"upon_final_delivery",label:"Upon final delivery"},{value:"immediately",label:"Immediately upon creation"},{value:"licensed",label:"Work remains licensed, not transferred"}];function Fi({className:t}){const{control:s,watch:i}=$(),{engagementType:n}=K(),m=i("termType")||"fixed",o=n==="retainer";return e.jsxs("div",{className:C("wizard-step-content",t),children:[e.jsxs("div",{className:"step-header",children:[e.jsx("h2",{className:"step-title",children:"Relationship Terms"}),e.jsx("p",{className:"step-description",children:"Define how the engagement can be ended and how ownership transfers."})]}),e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Agreement Term"}),e.jsx("div",{className:"term-options",children:zi.map(a=>e.jsx(F,{name:"termType",control:s,render:({field:c})=>e.jsxs("label",{className:C("term-option",c.value===a.value&&"active"),children:[e.jsx("input",{type:"radio",value:a.value,checked:c.value===a.value,onChange:g=>c.onChange(g.target.value)}),e.jsxs("div",{children:[e.jsx("span",{className:"term-label",children:a.label}),e.jsx("span",{className:"term-desc",children:a.description})]})]})},a.value))})]}),e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Termination Notice"}),e.jsx("p",{className:"section-hint",children:"How much notice is required to end the agreement?"}),e.jsx("div",{className:"form-row",children:e.jsxs("div",{className:"form-group",children:[e.jsx("label",{className:"form-label",children:"Notice Period (Days)"}),e.jsx(F,{name:"terminationNoticeDays",control:s,render:({field:a})=>e.jsx("input",{type:"number",min:"0",max:"90",className:"input",style:{width:100},value:a.value||0,onChange:c=>a.onChange(parseInt(c.target.value)||0)})})]})}),e.jsx("p",{className:"form-hint",children:m==="month-to-month"?"Either party must give this much notice to end the agreement.":"Client must give this much notice to cancel before completion."})]}),m==="fixed"&&!o&&e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Early Cancellation"}),e.jsx("p",{className:"section-hint",children:"What percentage of the remaining amount is owed if the client cancels early?"}),e.jsx("div",{className:"form-row",children:e.jsxs("div",{className:"form-group",children:[e.jsx("label",{className:"form-label",children:"Cancellation Coverage"}),e.jsxs("div",{className:"input-with-suffix",children:[e.jsx(F,{name:"cancellationCoveragePercent",control:s,render:({field:a})=>e.jsx("input",{type:"number",min:"0",max:"100",className:"input",style:{width:100},value:a.value||0,onChange:c=>a.onChange(parseInt(c.target.value)||0)})}),e.jsx("span",{className:"input-suffix",children:"%"})]})]})}),e.jsx("p",{className:"form-hint",children:"Common values: 25-50% of remaining amount."})]}),e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Ownership Transfer"}),e.jsx("p",{className:"section-hint",children:"When does ownership of the work transfer to the client?"}),e.jsx("div",{className:"form-group",children:e.jsx(F,{name:"ownershipTransferRule",control:s,render:({field:a})=>e.jsx("select",{className:"select",value:a.value||"upon_full_payment",onChange:c=>a.onChange(c.target.value),children:Li.map(c=>e.jsx("option",{value:c.value,children:c.label},c.value))})})}),e.jsx("p",{className:"form-hint",children:`"Upon full payment" is recommended to protect your work until you're paid.`})]}),e.jsx("style",{children:`
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
      `})]})}const Mi=[{name:"confidentiality",label:"Confidentiality",description:"Both parties agree to keep confidential information private."},{name:"ipOwnership",label:"IP Ownership",description:"Intellectual property rights and their transfer are clearly defined."},{name:"warrantyDisclaimer",label:"Warranty Disclaimer",description:'Work is provided "as is" without implied warranties.'},{name:"limitationOfLiability",label:"Limitation of Liability",description:"Liability is limited to the amount paid under this agreement."},{name:"nonSolicitation",label:"Non-Solicitation",description:"Neither party will solicit the other's employees or contractors."}],Oi=[{value:"negotiation",label:"Good Faith Negotiation",description:"Parties will first attempt to resolve disputes through direct discussion."},{value:"mediation",label:"Mediation",description:"Unresolved disputes go to a neutral mediator before any legal action."},{value:"arbitration",label:"Binding Arbitration",description:"Disputes are resolved by a binding arbitration process."}];function Bi({className:t}){const{register:s,control:i}=$();return e.jsxs("div",{className:C("wizard-step-content",t),children:[e.jsxs("div",{className:"step-header",children:[e.jsx("h2",{className:"step-title",children:"Standard Terms"}),e.jsx("p",{className:"step-description",children:"Select which standard legal clauses to include in the agreement."})]}),e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Legal Clauses"}),e.jsx("p",{className:"section-hint",children:"These are common protective clauses. Enable the ones relevant to your engagement."}),e.jsx("div",{className:"terms-list",children:Mi.map(n=>e.jsxs("label",{className:"term-toggle",children:[e.jsxs("div",{className:"term-info",children:[e.jsx("span",{className:"term-label",children:n.label}),e.jsx("span",{className:"term-desc",children:n.description})]}),e.jsx("input",{type:"checkbox",className:"toggle",...s(n.name)})]},n.name))})]}),e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Dispute Resolution"}),e.jsx("p",{className:"section-hint",children:"How should disputes be resolved if they arise?"}),e.jsx("div",{className:"dispute-options",children:Oi.map(n=>e.jsx(F,{name:"disputePath",control:i,render:({field:m})=>e.jsxs("label",{className:C("dispute-option",m.value===n.value&&"active"),children:[e.jsx("input",{type:"radio",value:n.value,checked:m.value===n.value,onChange:o=>m.onChange(o.target.value)}),e.jsxs("div",{children:[e.jsx("span",{className:"dispute-label",children:n.label}),e.jsx("span",{className:"dispute-desc",children:n.description})]})]})},n.value))})]}),e.jsxs("div",{className:"form-section",children:[e.jsx("h3",{className:"section-title",children:"Governing Law"}),e.jsx("p",{className:"section-hint",children:"Which jurisdiction's laws govern this agreement?"}),e.jsxs("div",{className:"form-group",children:[e.jsx("input",{type:"text",className:"input",placeholder:"e.g., State of Delaware, USA",...s("governingLaw")}),e.jsx("p",{className:"form-hint",children:"Optional. If not specified, the laws of your location typically apply."})]})]}),e.jsx("style",{children:`
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
      `})]})}function _i({risks:t,onFinalize:s,isProcessing:i=!1,className:n}){const{watch:m}=$(),{setStep:o,engagementType:a,engagementCategory:c,primaryLanguage:g}=K(),p=m(),r=Vt(t),w=Ue(t),S=(y,k)=>{if(y===void 0||y===0)return"—";const E=y/100;return new Intl.NumberFormat("en-US",{style:"currency",currency:k||"USD"}).format(E)},x=({stepIndex:y,label:k,children:E})=>e.jsxs("button",{type:"button",className:"section-link",onClick:()=>o(y),children:[e.jsxs("div",{className:"section-link-header",children:[e.jsxs("span",{className:"section-link-step",children:["Step ",y+1]}),e.jsx("span",{className:"section-link-label",children:k||oe[y]}),e.jsx("span",{className:"section-link-edit",children:"Edit"})]}),e.jsx("div",{className:"section-link-content",children:E})]});return e.jsxs("div",{className:C("wizard-step-content review-step",n),children:[e.jsxs("div",{className:"step-header",children:[e.jsx("h2",{className:"step-title",children:"Review & Finalize"}),e.jsx("p",{className:"step-description",children:"Review your engagement agreement before exporting."})]}),e.jsx("div",{className:"review-section",children:e.jsx(We,{risks:t})}),e.jsxs("div",{className:"review-cards",children:[e.jsxs(x,{stepIndex:0,label:"Client & Type",children:[e.jsxs("div",{className:"review-item",children:[e.jsx("span",{className:"review-label",children:"Client"}),e.jsx("span",{className:"review-value",children:p.clientName||"—"})]}),p.projectName&&e.jsxs("div",{className:"review-item",children:[e.jsx("span",{className:"review-label",children:"Project"}),e.jsx("span",{className:"review-value",children:p.projectName})]}),e.jsxs("div",{className:"review-item",children:[e.jsx("span",{className:"review-label",children:"Type"}),e.jsxs("span",{className:"review-value",children:[a==="task"?"Task-Based":"Retainer"," • ",c]})]}),e.jsxs("div",{className:"review-item",children:[e.jsx("span",{className:"review-label",children:"Language"}),e.jsx("span",{className:"review-value",children:g==="ar"?"Arabic":"English"})]})]}),e.jsxs(x,{stepIndex:1,label:"Summary",children:[e.jsxs("div",{className:"review-item",children:[e.jsx("span",{className:"review-label",children:"Title"}),e.jsx("span",{className:"review-value",children:p.title||"—"})]}),p.summary&&e.jsx("div",{className:"review-item",children:e.jsx("span",{className:"review-value review-text",children:p.summary})})]}),e.jsxs(x,{stepIndex:2,label:"Scope",children:[e.jsxs("div",{className:"review-item",children:[e.jsx("span",{className:"review-label",children:"Deliverables"}),e.jsxs("span",{className:"review-value",children:[p.deliverables?.length||0," items"]})]}),e.jsxs("div",{className:"review-item",children:[e.jsx("span",{className:"review-label",children:"Exclusions"}),e.jsxs("span",{className:"review-value",children:[p.exclusions?.length||0," items"]})]}),e.jsxs("div",{className:"review-item",children:[e.jsx("span",{className:"review-label",children:"Dependencies"}),e.jsxs("span",{className:"review-value",children:[p.dependencies?.length||0," items"]})]})]}),e.jsxs(x,{stepIndex:3,label:"Timeline",children:[e.jsxs("div",{className:"review-item",children:[e.jsx("span",{className:"review-label",children:"Start"}),e.jsx("span",{className:"review-value",children:p.startDate?new Date(p.startDate).toLocaleDateString():"—"})]}),e.jsxs("div",{className:"review-item",children:[e.jsx("span",{className:"review-label",children:"End"}),e.jsx("span",{className:"review-value",children:p.endDate?new Date(p.endDate).toLocaleDateString():"—"})]}),e.jsxs("div",{className:"review-item",children:[e.jsx("span",{className:"review-label",children:"Milestones"}),e.jsx("span",{className:"review-value",children:p.milestones?.length||0})]}),e.jsxs("div",{className:"review-item",children:[e.jsx("span",{className:"review-label",children:"Review Window"}),e.jsxs("span",{className:"review-value",children:[p.reviewWindowDays||0," days"]})]})]}),e.jsxs(x,{stepIndex:5,label:"Payment",children:[a==="task"?e.jsxs(e.Fragment,{children:[e.jsxs("div",{className:"review-item",children:[e.jsx("span",{className:"review-label",children:"Total"}),e.jsx("span",{className:"review-value",children:S(p.totalAmountMinor,p.currency)})]}),e.jsxs("div",{className:"review-item",children:[e.jsx("span",{className:"review-label",children:"Deposit"}),e.jsxs("span",{className:"review-value",children:[p.depositPercent||0,"%"]})]}),e.jsxs("div",{className:"review-item",children:[e.jsx("span",{className:"review-label",children:"Payments"}),e.jsxs("span",{className:"review-value",children:[p.scheduleItems?.length||0," scheduled"]})]})]}):e.jsxs(e.Fragment,{children:[e.jsxs("div",{className:"review-item",children:[e.jsx("span",{className:"review-label",children:"Monthly"}),e.jsx("span",{className:"review-value",children:S(p.retainerAmountMinor,p.currency)})]}),e.jsxs("div",{className:"review-item",children:[e.jsx("span",{className:"review-label",children:"Billing Day"}),e.jsx("span",{className:"review-value",children:p.billingDay||1})]})]}),e.jsxs("div",{className:"review-item",children:[e.jsx("span",{className:"review-label",children:"Late Fee"}),e.jsx("span",{className:"review-value",children:p.lateFeeEnabled?"Enabled":"Disabled"})]})]}),e.jsxs(x,{stepIndex:6,label:"Relationship",children:[e.jsxs("div",{className:"review-item",children:[e.jsx("span",{className:"review-label",children:"Term"}),e.jsx("span",{className:"review-value",children:p.termType==="month-to-month"?"Month-to-Month":"Fixed"})]}),e.jsxs("div",{className:"review-item",children:[e.jsx("span",{className:"review-label",children:"Notice Period"}),e.jsxs("span",{className:"review-value",children:[p.terminationNoticeDays||0," days"]})]}),e.jsxs("div",{className:"review-item",children:[e.jsx("span",{className:"review-label",children:"Ownership"}),e.jsx("span",{className:"review-value",children:p.ownershipTransferRule?.replace(/_/g," ")||"—"})]})]}),e.jsxs(x,{stepIndex:7,label:"Terms",children:[e.jsxs("div",{className:"review-terms-badges",children:[p.confidentiality&&e.jsx("span",{className:"term-badge",children:"Confidentiality"}),p.ipOwnership&&e.jsx("span",{className:"term-badge",children:"IP Ownership"}),p.warrantyDisclaimer&&e.jsx("span",{className:"term-badge",children:"Warranty"}),p.limitationOfLiability&&e.jsx("span",{className:"term-badge",children:"Liability Limit"}),p.nonSolicitation&&e.jsx("span",{className:"term-badge",children:"Non-Solicitation"})]}),e.jsxs("div",{className:"review-item",children:[e.jsx("span",{className:"review-label",children:"Disputes"}),e.jsx("span",{className:"review-value",children:p.disputePath||"—"})]})]})]}),e.jsxs("div",{className:"finalize-section",children:[r&&e.jsxs("div",{className:"warning-banner",children:[e.jsx("svg",{viewBox:"0 0 20 20",fill:"currentColor",width:"20",height:"20",children:e.jsx("path",{fillRule:"evenodd",d:"M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z",clipRule:"evenodd"})}),e.jsxs("span",{children:["You have ",w.high," high-severity ",w.high===1?"issue":"issues","that should be addressed before finalizing."]})]}),e.jsx("button",{type:"button",className:"btn btn-primary btn-lg finalize-btn",onClick:s,disabled:i,children:i?"Processing...":"Finalize & Export PDF"}),e.jsx("p",{className:"finalize-hint",children:"Finalizing will create a locked version of this engagement that cannot be edited."})]}),e.jsx("style",{children:`
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
      `})]})}const Vi=de({profileId:P().min(1,"Profile is required"),profileName:P(),clientId:P().min(1,"Client is required"),clientName:P(),projectId:P().optional(),projectName:P().optional(),title:P().min(1,"Title is required"),summary:P(),clientGoal:P().optional(),deliverables:X(de({id:P(),description:P(),quantity:_().optional(),format:P().optional()})),exclusions:X(P()),dependencies:X(P()),startDate:P().optional(),endDate:P().optional(),milestones:X(de({id:P(),title:P(),targetDate:P().optional(),deliverableIds:X(P())})),reviewWindowDays:_(),silenceEqualsApproval:Y(),revisionRounds:_(),revisionDefinition:X(P()),bugFixDays:_().optional(),changeRequestRule:Y(),scopeCategories:X(P()).optional(),monthlyCapacity:P().optional(),responseTimeDays:_().optional(),currency:te(["USD","ILS","EUR"]),totalAmountMinor:_().optional(),depositPercent:_().optional(),scheduleItems:X(de({id:P(),label:P(),trigger:te(["on_signing","on_milestone","on_completion","monthly"]),milestoneId:P().optional(),amountMinor:_(),currency:te(["USD","ILS","EUR"])})),lateFeeEnabled:Y(),retainerAmountMinor:_().optional(),billingDay:_().optional(),rolloverRule:te(["none","carry","expire"]).optional(),outOfScopeRateMinor:_().optional(),termType:te(["fixed","month-to-month"]),terminationNoticeDays:_(),cancellationCoveragePercent:_().optional(),ownershipTransferRule:P(),confidentiality:Y(),ipOwnership:Y(),warrantyDisclaimer:Y(),limitationOfLiability:Y(),nonSolicitation:Y(),disputePath:te(["negotiation","mediation","arbitration"]),governingLaw:P().optional()});function en(){const t=Qe({strict:!1}),s=Ke({strict:!1}),i=ye(),n=t.engagementId,m=!!n,{currentStep:o,engagementType:a,engagementCategory:c,primaryLanguage:g,isDirty:p,isSaving:r,setDirty:w,setLastSavedAt:S,setIsSaving:x,setPrefill:y,initializeForEdit:k,setEngagementId:E}=K(),{data:T}=ct(n||""),{data:A}=Oe(n||""),{data:h=[]}=he(),{data:d=[]}=ue(),N=pt(),D=xt(),O=vt(),{showToast:z}=Me(),q=at({resolver:Ze(Vi),defaultValues:Pe,mode:"onChange"}),{watch:V,reset:U,setValue:b}=q,u=V(),f=Bt(u,a,c),B=I.useMemo(()=>h.find(R=>R.id===u.clientId),[h,u.clientId]),J=I.useMemo(()=>d.find(R=>R.id===u.profileId),[d,u.profileId]);Ft(n,u,p,S),I.useEffect(()=>{if(!m){const R=Ve();if(R&&!R.engagementId&&Mt())U({...Pe,...R.snapshot}),w(!0);else{if(s.profileId&&y({profileId:s.profileId}),s.clientId){const Z=h.find(Ce=>Ce.id===s.clientId);Z&&(b("clientId",Z.id),b("clientName",Z.name))}s.type&&y({type:s.type})}}},[m,s,h,U,b,y,w]),I.useEffect(()=>{m&&T&&A&&(k({engagementId:T.id,type:T.type,category:T.category,language:T.primaryLanguage}),U(A.snapshot))},[m,T,A,k,U]),I.useEffect(()=>{const R=V(()=>{p||w(!0)});return()=>R.unsubscribe()},[V,p,w]);const ee=async()=>{x(!0);try{let R=n;R||(R=(await N.mutateAsync({profileId:u.profileId,clientId:u.clientId,projectId:u.projectId,type:a,category:c,primaryLanguage:g,status:"draft"})).id,E(R),window.history.replaceState({},"",`/engagements/${R}/edit`)),await D.mutateAsync({engagementId:R,snapshot:u,status:"draft"}),w(!1),S(new Date().toISOString()),Te()}catch(R){console.error("Failed to save draft:",R)}finally{x(!1)}},H=async()=>{x(!0);try{let R=n;R||(R=(await N.mutateAsync({profileId:u.profileId,clientId:u.clientId,projectId:u.projectId,type:a,category:c,primaryLanguage:g,status:"draft"})).id),await O.mutateAsync({engagementId:R,snapshot:u});const Z=await Be({snapshot:u,client:B,language:g,type:a,category:c,profile:J});Z.success?(Te(),z("Engagement finalized and PDF downloaded"),i({to:"/engagements"})):(console.error("PDF generation failed:",Z.error),z("Engagement saved but PDF download failed. Please try downloading again."))}catch(R){console.error("Failed to finalize:",R),z("Failed to finalize engagement. Please try again.")}finally{x(!1)}},W=()=>{switch(o){case 0:return e.jsx($t,{});case 1:return e.jsx(Yt,{});case 2:return e.jsx(yi,{});case 3:return e.jsx(Ni,{});case 4:return e.jsx(ki,{});case 5:return e.jsx(Ai,{});case 6:return e.jsx(Fi,{});case 7:return e.jsx(Bi,{});case 8:return e.jsx(_i,{risks:f,onFinalize:H,isProcessing:r});default:return null}};return e.jsxs(e.Fragment,{children:[e.jsx(Le,{title:m?"Edit Engagement":"New Engagement",breadcrumbs:[{label:"Engagements",href:"/engagements"},{label:m?"Edit":"New"}]}),e.jsx("div",{className:"page-content",children:e.jsx(rt,{...q,children:e.jsxs("form",{onSubmit:R=>R.preventDefault(),children:[e.jsx(Wt,{risks:f}),e.jsxs("div",{className:"wizard-layout",children:[e.jsxs("div",{className:"wizard-form",children:[W(),o<8&&e.jsx(Gt,{onSaveDraft:ee,onFinalize:H,isSaving:r,isValid:!0})]}),e.jsxs("div",{className:"wizard-sidebar",children:[e.jsxs("div",{className:"sidebar-section",children:[e.jsx("h3",{className:"sidebar-title",children:"Clarity Check"}),e.jsx(We,{risks:f})]}),e.jsxs("div",{className:"sidebar-section preview-section",children:[e.jsx("h3",{className:"sidebar-title",children:"Preview"}),e.jsx("div",{className:"preview-container",children:e.jsx(qt,{snapshot:u,client:B,language:g})})]})]})]})]})})}),e.jsx("style",{children:`
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
      `})]})}export{en as EngagementWizardPage,Zi as EngagementsPage};
