// TODO: Create airday message
use flatbuffers::{FlatBufferBuilder, WIPOffset};

use crate::sync::proto_generated::proto::{
    AirdayBatchComponentProto, AirdayMessageProto, AirdayMessageProtoArgs, MessageProto,
    MessageWrapperProto, MessageWrapperProtoArgs,
};

pub fn create_airday_message_with_builder<'a>(
    builder: &mut FlatBufferBuilder<'a>,
    action_offsets: Vec<WIPOffset<AirdayBatchComponentProto<'a>>>,
) -> Vec<u8> {
    // 1. Build AirdayMessageProto (contains batches)
    let batch = builder.create_vector(&action_offsets);
    let message_offset = AirdayMessageProto::create(
        builder,
        &AirdayMessageProtoArgs {
            batch: Some(batch),
            ..Default::default()
        },
    );

    // 2. Build message wrapper
    let wrapper = MessageWrapperProto::create(
        builder,
        &MessageWrapperProtoArgs {
            message_type: MessageProto::AirdayMessageProto,
            message: Some(message_offset.as_union_value()),
            ..Default::default()
        },
    );

    builder.finish(wrapper, None);
    builder.finished_data().to_vec()
}
