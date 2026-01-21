import type { LegalClausesConfig } from './types';

export const clausesEn: LegalClausesConfig = {
  version: "1.0.0",
  sections: [
    {
      id: "5",
      title: "Intellectual Property",
      toggleKey: "ipOwnership",
      subsections: [
        {
          id: "5.1",
          title: "Work Product",
          content: "In this Agreement, \"Work Product\" means all discoveries, designs, developments, improvements, inventions (whether or not patentable), works of authorship, trade secrets, software, source code, documentation, technical data, and any other works, materials, and deliverables that {serviceprovider}, solely or jointly with others, creates, conceives, develops, or reduces to practice in the performance of the Services."
        },
        {
          id: "5.2",
          title: "Assignment of Work Product",
          content: "Upon full payment of all amounts due under this Agreement, {serviceprovider} hereby irrevocably assigns to {company} all right, title, and interest in and to the Work Product, including all intellectual property rights therein. Until such full payment, {serviceprovider} retains ownership of the Work Product, and {company} shall have no rights to use, modify, or distribute the Work Product."
        },
        {
          id: "5.3",
          title: "Pre-existing Materials",
          content: "{serviceprovider} retains all right, title, and interest in any materials, tools, libraries, frameworks, or intellectual property owned by or licensed to {serviceprovider} prior to the Effective Date or developed independently outside the scope of this Agreement (\"Pre-existing Materials\"). To the extent any Pre-existing Materials are incorporated into the Work Product, {serviceprovider} grants {company} a non-exclusive, royalty-free, perpetual, worldwide license to use such Pre-existing Materials solely as part of the Work Product."
        },
        {
          id: "5.4",
          title: "Third-Party Materials",
          content: "If the Work Product incorporates any third-party materials (including open-source software), {serviceprovider} shall identify such materials and their applicable license terms. {company} agrees to comply with all such third-party license terms. {serviceprovider} makes no representations regarding the suitability of such third-party materials for {company}'s intended use."
        },
        {
          id: "5.5",
          title: "Moral Rights",
          content: "To the extent permitted by applicable law, {serviceprovider} waives and agrees not to assert any moral rights in the Work Product, including rights of attribution, integrity, and disclosure."
        },
        {
          id: "5.6",
          title: "Further Assurances",
          content: "{serviceprovider} agrees to execute any documents and take any actions reasonably requested by {company} to perfect, register, or enforce {company}'s rights in the Work Product, at {company}'s expense."
        },
        {
          id: "5.7",
          title: "Portfolio Rights",
          content: "{serviceprovider} retains the right to display, reference, and describe the Work Product (excluding Confidential Information) in {serviceprovider}'s portfolio, marketing materials, and similar promotional contexts, unless {company} provides written notice to the contrary."
        }
      ]
    },
    {
      id: "6",
      title: "Confidentiality",
      toggleKey: "confidentiality",
      subsections: [
        {
          id: "6.1",
          title: "Definition",
          content: "\"Confidential Information\" means any non-public information disclosed by one party (the \"Discloser\") to the other party (the \"Recipient\") in connection with this Agreement, whether oral, written, electronic, or otherwise, that is designated as confidential or that reasonably should be understood to be confidential given the nature of the information and circumstances of disclosure. Confidential Information includes, without limitation, business plans, technical data, trade secrets, customer information, financial information, and proprietary processes."
        },
        {
          id: "6.2",
          title: "Obligations",
          content: "The Recipient shall: (a) hold the Confidential Information in strict confidence; (b) not disclose the Confidential Information to any third party except as expressly permitted herein; (c) use the Confidential Information only for purposes of performing or receiving the Services; and (d) protect the Confidential Information using at least the same degree of care it uses to protect its own confidential information, but in no event less than reasonable care. The Recipient may disclose Confidential Information to its employees, contractors, and advisors who have a need to know and are bound by confidentiality obligations at least as protective as those herein."
        },
        {
          id: "6.3",
          title: "Exceptions",
          content: "Confidential Information does not include information that: (a) is or becomes publicly available through no fault of the Recipient; (b) was rightfully known to the Recipient prior to disclosure; (c) is rightfully obtained by the Recipient from a third party without restriction; or (d) is independently developed by the Recipient without use of the Confidential Information. The Recipient may disclose Confidential Information if required by law, provided the Recipient gives the Discloser prompt notice and reasonable assistance to seek a protective order."
        }
      ]
    },
    {
      id: "7",
      title: "Ownership and Return of Materials",
      toggleKey: "confidentiality",
      subsections: [
        {
          id: "7.1",
          title: "Return of Materials",
          content: "Upon termination of this Agreement or upon the Discloser's written request, the Recipient shall promptly return or destroy all Confidential Information and any copies thereof, and shall certify in writing that it has done so. Notwithstanding the foregoing, the Recipient may retain copies of Confidential Information to the extent required by applicable law or for legitimate archival purposes, subject to continued confidentiality obligations."
        }
      ]
    },
    {
      id: "8",
      title: "Indemnification and Limitation of Liability",
      toggleKey: "limitationOfLiability",
      subsections: [
        {
          id: "8.1",
          title: "Mutual Indemnification",
          content: "Each party (the \"Indemnifying Party\") agrees to indemnify, defend, and hold harmless the other party and its officers, directors, employees, and agents (collectively, the \"Indemnified Parties\") from and against any claims, damages, losses, liabilities, costs, and expenses (including reasonable attorneys' fees) arising out of or relating to: (a) the Indemnifying Party's breach of any representation, warranty, or obligation under this Agreement; (b) the Indemnifying Party's negligence or willful misconduct; or (c) any third-party claim that the Indemnifying Party's materials infringe such third party's intellectual property rights."
        },
        {
          id: "8.2",
          title: "Limitation of Liability",
          content: "EXCEPT FOR BREACHES OF CONFIDENTIALITY, INDEMNIFICATION OBLIGATIONS, OR WILLFUL MISCONDUCT, NEITHER PARTY SHALL BE LIABLE TO THE OTHER FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING LOSS OF PROFITS, REVENUE, DATA, OR USE, REGARDLESS OF THE THEORY OF LIABILITY, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES."
        },
        {
          id: "8.3",
          title: "Liability Cap",
          content: "EXCEPT FOR BREACHES OF CONFIDENTIALITY, INDEMNIFICATION OBLIGATIONS, OR WILLFUL MISCONDUCT, THE TOTAL AGGREGATE LIABILITY OF EITHER PARTY ARISING OUT OF OR RELATING TO THIS AGREEMENT SHALL NOT EXCEED THE TOTAL AMOUNTS PAID OR PAYABLE BY {company} TO {serviceprovider} UNDER THIS AGREEMENT DURING THE TWELVE (12) MONTHS PRECEDING THE CLAIM."
        }
      ]
    },
    {
      id: "9",
      title: "No Conflict of Interest",
      toggleKey: "nonSolicitation",
      subsections: [
        {
          id: "9.1",
          title: "Non-Solicitation",
          content: "During the term of this Agreement and for a period of twelve (12) months thereafter, neither party shall directly or indirectly solicit, recruit, or hire any employee or contractor of the other party who was involved in the performance or receipt of the Services, without the other party's prior written consent. This restriction shall not apply to general employment advertisements or unsolicited applications."
        },
        {
          id: "9.2",
          title: "No Exclusivity",
          content: "Unless otherwise expressly agreed in writing, this Agreement does not create an exclusive relationship between the parties. {serviceprovider} is free to provide similar services to other clients, and {company} is free to engage other service providers, provided that such activities do not breach the confidentiality or intellectual property provisions herein."
        }
      ]
    },
    {
      id: "10",
      title: "Term and Termination",
      subsections: [
        {
          id: "10.1",
          title: "Term",
          content: "This Agreement shall commence on the Effective Date ({effectivedate}) and shall continue until the completion of the Services or {terminationdate}, whichever occurs first, unless earlier terminated in accordance with this Section."
        },
        {
          id: "10.2",
          title: "Termination for Convenience",
          content: "Either party may terminate this Agreement for any reason upon {noticeperiod} days' prior written notice to the other party. Upon such termination, {company} shall pay {serviceprovider} for all Services satisfactorily performed through the effective date of termination."
        },
        {
          id: "10.3",
          title: "Termination for Cause",
          content: "Either party may terminate this Agreement immediately upon written notice if the other party: (a) materially breaches this Agreement and fails to cure such breach within fifteen (15) days after receiving written notice thereof; (b) becomes insolvent or files or has filed against it a petition in bankruptcy; or (c) ceases to do business in the normal course."
        },
        {
          id: "10.4",
          title: "Effect of Termination",
          content: "Upon termination: (a) all licenses granted hereunder shall terminate, except as otherwise provided; (b) each party shall return or destroy the other party's Confidential Information; (c) {company} shall pay all amounts due for Services performed through the termination date; and (d) the provisions of Sections relating to intellectual property (upon full payment), confidentiality, indemnification, limitation of liability, and general provisions shall survive termination."
        }
      ]
    },
    {
      id: "11",
      title: "Support and Warranty Period",
      subsections: [
        {
          id: "11.1",
          title: "Support Period",
          content: "Following delivery and acceptance of the Work Product, {serviceprovider} shall provide support for a period of {supportperiod} to address any defects or bugs in the Work Product that prevent it from performing materially in accordance with its specifications. This support is limited to fixing defects and does not include enhancements, new features, or changes requested by {company}."
        },
        {
          id: "11.2",
          title: "Warranty Disclaimer",
          content: "EXCEPT AS EXPRESSLY SET FORTH IN THIS AGREEMENT, {serviceprovider} PROVIDES THE SERVICES AND WORK PRODUCT \"AS IS\" AND MAKES NO WARRANTIES, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, OR NON-INFRINGEMENT. {serviceprovider} DOES NOT WARRANT THAT THE SERVICES OR WORK PRODUCT WILL BE ERROR-FREE, UNINTERRUPTED, OR MEET {company}'S SPECIFIC REQUIREMENTS."
        }
      ]
    },
    {
      id: "12",
      title: "General Provisions",
      subsections: [
        {
          id: "12.1",
          title: "Governing Law",
          content: "This Agreement shall be governed by and construed in accordance with the laws of {governinglaw}, without regard to its conflicts of law principles. Any disputes arising under or relating to this Agreement shall be resolved in the courts of competent jurisdiction in {governinglaw}."
        },
        {
          id: "12.2",
          title: "Entire Agreement",
          content: "This Agreement constitutes the entire agreement between the parties with respect to the subject matter hereof and supersedes all prior and contemporaneous agreements, representations, and understandings, whether written or oral. No modification of this Agreement shall be binding unless in writing and signed by both parties."
        },
        {
          id: "12.3",
          title: "Severability",
          content: "If any provision of this Agreement is held to be invalid, illegal, or unenforceable, such provision shall be modified to the minimum extent necessary to make it valid, legal, and enforceable, or if modification is not possible, shall be severed from this Agreement. The remaining provisions shall continue in full force and effect."
        },
        {
          id: "12.4",
          title: "Waiver",
          content: "The failure of either party to enforce any right or provision of this Agreement shall not constitute a waiver of such right or provision. Any waiver must be in writing and signed by the waiving party."
        },
        {
          id: "12.5",
          title: "Assignment",
          content: "Neither party may assign or transfer this Agreement or any rights or obligations hereunder without the prior written consent of the other party, except that either party may assign this Agreement in connection with a merger, acquisition, or sale of all or substantially all of its assets. This Agreement shall be binding upon and inure to the benefit of the parties and their permitted successors and assigns."
        },
        {
          id: "12.6",
          title: "Independent Contractor",
          content: "{serviceprovider} is an independent contractor and not an employee, agent, partner, or joint venturer of {company}. {serviceprovider} shall be solely responsible for all taxes, benefits, and insurance arising from {serviceprovider}'s performance under this Agreement. Nothing in this Agreement shall be construed to create an employment or agency relationship between the parties."
        },
        {
          id: "12.7",
          title: "Notices",
          content: "All notices under this Agreement shall be in writing and shall be deemed given when delivered personally, sent by confirmed email, or sent by recognized overnight courier to the addresses set forth in this Agreement or such other address as a party may designate by notice."
        }
      ]
    }
  ]
};
