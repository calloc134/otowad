use serde::{Deserialize, Serialize};
use uuid::Uuid;

macro_rules! id_newtype {
    ($name:ident) => {
        #[derive(
            Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
        )]
        #[serde(transparent)]
        pub struct $name(pub Uuid);

        impl $name {
            pub fn new() -> Self {
                Self(Uuid::new_v4())
            }
        }

        impl Default for $name {
            fn default() -> Self {
                Self::new()
            }
        }
    };
}

id_newtype!(TrackId);
id_newtype!(ClipId);
id_newtype!(ContentId);
id_newtype!(MediaId);
id_newtype!(FxId);
id_newtype!(AutomationId);
id_newtype!(AnalysisId);
id_newtype!(PitchLinkId);
id_newtype!(NoteId);
