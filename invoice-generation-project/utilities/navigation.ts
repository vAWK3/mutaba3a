import { ProfileContext } from '@/contexts/ProfileContext';
import { useRouter } from 'next/navigation';
import { useContext } from 'react';

const useNavigateToPage = () => {


    console.log('STARTING FROM HERE');

    const router = useRouter();

    const profiles = useContext(ProfileContext);

    let id = profiles?.activeProfile?.id;

    console.log('***** NAVIGATE TO PAGE **** \n\n\nprofiles is ', profiles);
    console.log('id is ', id);

    // if (!id) {
    //     window.location.href = "/";
    // }

    const navigateToPage = (page: 'documents' | 'dashboard' | 'clients' | 'documents_new' | 'clients_new', params?: Record<string, any>) => {

        if (!id) {
            //TODO: update to redirect to profile selection screen

            id = 2;
            // return;
        }



        let url = `/${id}/${page.replaceAll('_', '/')}`;

        if (params) {
            const queryString = new URLSearchParams(params).toString();
            url += `?${queryString}`;
        }

        router.push(url);
    };

    return { navigateToPage };
};

export default useNavigateToPage;